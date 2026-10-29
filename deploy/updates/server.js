'use strict';
/**
 * 自建 expo-updates 服务端（OTA），零依赖，只用 Node 标准库。
 *
 * 协议实现严格对齐官方参考实现 expo/custom-expo-updates-server：
 *   - manifest 字段：id / createdAt / runtimeVersion / assets / launchAsset / metadata / extra
 *   - id          = sha256(metadata.json) 的 hex 前 32 位切成 UUID
 *   - asset.hash  = sha256(buffer) → base64 → base64url（+→- /→_ 去掉 =）
 *   - asset.key   = md5(buffer) hex
 *   - fileExtension：启动包为 .bundle，普通资源为 .<ext>
 *   - contentType：启动包 application/javascript，普通资源按 ext
 *   - protocol v1 用 multipart/mixed（manifest 段 + extensions 段），v0 用纯 JSON
 *
 * 存储布局（channel 与 runtimeVersion 双重区分，指针文件指向当前生效版本）：
 *   $DATA_DIR/<channel>/<runtimeVersion>/current.json          {"updateId":"...","createdAt":"..."}
 *   $DATA_DIR/<channel>/<runtimeVersion>/<updateId>/metadata.json
 *   $DATA_DIR/<channel>/<runtimeVersion>/<updateId>/expoConfig.json   （可选）
 *   $DATA_DIR/<channel>/<runtimeVersion>/<updateId>/bundles/*
 *   $DATA_DIR/<channel>/<runtimeVersion>/<updateId>/assets/*
 *
 * 路由（外层 nginx 用 /updates 前缀反代，直连时无前缀也认）：
 *   GET /manifest        客户端拉 manifest（永远按 manifest 处理）
 *   GET /  (= /updates、/updates/)  带 expo-* 头 → manifest；否则运维索引
 *   GET /assets/<channel>/<runtimeVersion>/<updateId>/<相对路径>   托管资源/启动包
 *   GET /healthz         容器探活
 * 客户端打的就是 updates.url 本身，所以入口路径形状必须全部兼容，且不得依赖任何跳转。
 */

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8081);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
// manifest 里所有 URL 的绝对前缀，必须与客户端 updates.url 完全一致
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://187.127.125.136/updates').replace(/\/+$/, '');
const DEFAULT_CHANNEL = process.env.DEFAULT_CHANNEL || 'production';

// channel / runtimeVersion / updateId 只允许安全字符，顺带堵死路径穿越
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const MIME = {
  js: 'application/javascript',
  mjs: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
};

// ---------------------------------------------------------------- 编解码工具

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Base64Url(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function toUUID(hex) {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function safeJoin(root, rel) {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function isDir(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function readdirSafe(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** metadata.json 的 createdTime：优先指针记录，其次 birthtime（某些文件系统给 1970，退化为 mtime） */
async function fallbackCreatedAt(file) {
  try {
    const st = await fsp.stat(file);
    const birth = st.birthtime ? st.birthtime.getTime() : 0;
    const date = birth > Date.UTC(2001, 0, 1) ? st.birthtime : st.mtime;
    return date.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ---------------------------------------------------------------- 更新解析

/** 读 data/<channel>/<runtimeVersion>/current.json 找到生效版本；指针缺失时退化为最新一次发布 */
async function resolveCurrentUpdate(channel, runtimeVersion) {
  const base = path.join(DATA_DIR, channel, runtimeVersion);
  const pointer = await readJson(path.join(base, 'current.json'));
  if (pointer && typeof pointer.updateId === 'string' && SEGMENT_RE.test(pointer.updateId)) {
    const dir = path.join(base, pointer.updateId);
    if (await isDir(dir)) {
      return {
        updateId: pointer.updateId,
        dir,
        createdAt: typeof pointer.createdAt === 'string' ? pointer.createdAt : null,
      };
    }
  }

  const dirs = [];
  for (const entry of await readdirSafe(base)) {
    if (!entry.isDirectory() || !SEGMENT_RE.test(entry.name)) continue;
    const st = await fsp.stat(path.join(base, entry.name)).catch(() => null);
    if (st) dirs.push({ name: entry.name, mtimeMs: st.mtimeMs });
  }
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { updateId: dirs[0].name, dir: path.join(base, dirs[0].name), createdAt: null };
}

function encodeRelPath(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

async function buildAssetMetadata({ dir, relPath, ext, isLaunch, channel, runtimeVersion, updateId }) {
  const abs = safeJoin(dir, relPath);
  if (!abs) throw new Error(`资源路径非法: ${relPath}`);
  let buffer;
  try {
    buffer = await fsp.readFile(abs);
  } catch {
    throw new Error(`更新 ${updateId} 缺少资源: ${relPath}`);
  }
  const suffix = isLaunch ? 'bundle' : ext;
  return {
    hash: sha256Base64Url(buffer),
    key: md5Hex(buffer),
    fileExtension: `.${suffix}`,
    contentType: isLaunch ? 'application/javascript' : MIME[String(ext).toLowerCase()] || 'application/octet-stream',
    url: `${PUBLIC_BASE_URL}/assets/${encodeURIComponent(channel)}/${encodeURIComponent(runtimeVersion)}/${encodeURIComponent(updateId)}/${encodeRelPath(relPath)}`,
  };
}

async function buildManifest({ channel, runtimeVersion, platform, update }) {
  const metadataPath = path.join(update.dir, 'metadata.json');
  let metadataBuffer;
  try {
    metadataBuffer = await fsp.readFile(metadataPath);
  } catch {
    throw new Error(`更新 ${update.updateId} 缺少 metadata.json`);
  }

  const metadataJson = JSON.parse(metadataBuffer.toString('utf8'));
  const fileMetadata = metadataJson.fileMetadata && metadataJson.fileMetadata[platform];
  if (!fileMetadata || !fileMetadata.bundle) {
    throw new Error(`更新 ${update.updateId} 没有 ${platform} 平台的产物`);
  }

  // 参考实现取 sha256(metadata.json) 前 32 位当 id。这里混入 updateId：
  // metadata.json 完全相同的两次发布（例如同名 bundle 的假更新）否则会撞 id，
  // 客户端会误判成「没有新版本」。
  const id = toUUID(sha256Hex(Buffer.concat([Buffer.from(`${update.updateId}:`), metadataBuffer])));
  const createdAt = update.createdAt || (await fallbackCreatedAt(metadataPath));

  const assets = [];
  for (const asset of fileMetadata.assets || []) {
    assets.push(
      await buildAssetMetadata({
        dir: update.dir,
        relPath: asset.path,
        ext: asset.ext,
        isLaunch: false,
        channel,
        runtimeVersion,
        updateId: update.updateId,
      }),
    );
  }

  const launchAsset = await buildAssetMetadata({
    dir: update.dir,
    relPath: fileMetadata.bundle,
    ext: null,
    isLaunch: true,
    channel,
    runtimeVersion,
    updateId: update.updateId,
  });

  // extra.expoClient 不是协议必填项（参考实现装了才带），有 expoConfig.json 就带上
  const expoConfig = await readJson(path.join(update.dir, 'expoConfig.json'));

  return {
    id,
    createdAt,
    runtimeVersion,
    assets,
    launchAsset,
    metadata: {},
    extra: expoConfig ? { expoClient: expoConfig } : {},
  };
}

// ---------------------------------------------------------------- 响应工具

function sendJson(res, status, payload, extraHeaders) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function buildMultipart(boundary, parts) {
  const chunks = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\nContent-Type: ${part.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(part.body);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function protocolHeaders(res, protocolVersion, isMultipart, contentType) {
  res.setHeader('expo-protocol-version', String(protocolVersion));
  res.setHeader('expo-sfv-version', '0');
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', contentType);
  void isMultipart;
}

// ---------------------------------------------------------------- /manifest

async function handleManifest(req, res, url) {
  const headers = req.headers;

  const platform = headers['expo-platform'] || url.searchParams.get('platform') || '';
  if (platform !== 'ios' && platform !== 'android') {
    return sendJson(res, 400, { error: 'Unsupported platform. Expected either ios or android.' });
  }

  const runtimeVersion = headers['expo-runtime-version'] || url.searchParams.get('runtime-version') || '';
  if (!runtimeVersion) {
    return sendJson(res, 400, { error: 'No runtimeVersion provided.' });
  }

  const channel = headers['expo-channel-name'] || url.searchParams.get('channel-name') || DEFAULT_CHANNEL;
  if (!SEGMENT_RE.test(channel) || !SEGMENT_RE.test(runtimeVersion)) {
    return sendJson(res, 400, { error: 'Invalid channel or runtimeVersion.' });
  }

  const rawProtocolVersion = headers['expo-protocol-version'];
  const protocolVersion = Number.parseInt(Array.isArray(rawProtocolVersion) ? 'NaN' : rawProtocolVersion || '0', 10);
  if (protocolVersion !== 0 && protocolVersion !== 1) {
    return sendJson(res, 400, { error: 'Unsupported protocol version. Expected either 0 or 1.' });
  }
  // 协议 v1 + 客户端没明确要求 application/json 时按官方实现回 multipart/mixed；
  // 纯 JSON 请求（curl、老客户端、protocol v0）一律回 JSON。
  const accept = String(headers.accept || '');
  const wantsMultipart = protocolVersion === 1 && !accept.includes('application/json');

  const update = await resolveCurrentUpdate(channel, runtimeVersion);
  if (!update) {
    return sendJson(res, 404, {
      error: `No update found for channel "${channel}" runtimeVersion "${runtimeVersion}".`,
    });
  }

  let manifest;
  try {
    manifest = await buildManifest({ channel, runtimeVersion, platform, update });
  } catch (error) {
    return sendJson(res, 404, { error: error.message });
  }

  // 协议 v1：客户端已经在跑这个版本 → noUpdateAvailable（免得重复下载 install）
  if (protocolVersion === 1 && headers['expo-current-update-id'] === manifest.id) {
    return sendDirective(res, protocolVersion, { type: 'noUpdateAvailable' }, wantsMultipart);
  }

  const assetRequestHeaders = {};
  for (const asset of [...manifest.assets, manifest.launchAsset]) {
    assetRequestHeaders[asset.key] = {};
  }
  const extensions = JSON.stringify({ assetRequestHeaders });

  if (!wantsMultipart) {
    return sendJson(res, 200, manifest, {
      'expo-protocol-version': String(protocolVersion),
      'expo-sfv-version': '0',
      'cache-control': 'private, max-age=0',
    });
  }

  const boundary = `----ExpoUpdates${crypto.randomBytes(12).toString('hex')}`;
  const body = buildMultipart(boundary, [
    { name: 'manifest', contentType: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify(manifest)) },
    { name: 'extensions', contentType: 'application/json', body: Buffer.from(extensions) },
  ]);
  protocolHeaders(res, protocolVersion, true, `multipart/mixed; boundary=${boundary}`);
  res.setHeader('content-length', body.length);
  res.writeHead(200);
  res.end(body);
}

function sendDirective(res, protocolVersion, directive, wantsMultipart) {
  if (!wantsMultipart) {
    return sendJson(res, 200, directive, {
      'expo-protocol-version': String(protocolVersion),
      'expo-sfv-version': '0',
      'cache-control': 'private, max-age=0',
    });
  }
  const boundary = `----ExpoUpdates${crypto.randomBytes(12).toString('hex')}`;
  const body = buildMultipart(boundary, [
    { name: 'directive', contentType: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify(directive)) },
  ]);
  protocolHeaders(res, protocolVersion, true, `multipart/mixed; boundary=${boundary}`);
  res.setHeader('content-length', body.length);
  res.writeHead(200);
  res.end(body);
}

// ---------------------------------------------------------------- /assets

// metadata.json 很小，但每个资源请求都读一次太浪费；按目录缓存，mtime 变了就失效
const metadataCache = new Map();

async function loadAssetTypeMap(dir) {
  const file = path.join(dir, 'metadata.json');
  let st;
  try {
    st = await fsp.stat(file);
  } catch {
    return null;
  }
  const cached = metadataCache.get(dir);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.map;

  const metadataJson = await readJson(file);
  if (!metadataJson || !metadataJson.fileMetadata) return null;

  // 同一路径在 ios/android 下 ext 相同；合并成一张 path → {ext, isBundle}
  const map = new Map();
  for (const platformMetadata of Object.values(metadataJson.fileMetadata)) {
    if (!platformMetadata) continue;
    if (platformMetadata.bundle) map.set(platformMetadata.bundle, { ext: null, isBundle: true });
    for (const asset of platformMetadata.assets || []) {
      map.set(asset.path, { ext: asset.ext, isBundle: false });
    }
  }
  metadataCache.set(dir, { mtimeMs: st.mtimeMs, map });
  return map;
}

async function handleAsset(req, res, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  // ['assets', channel, runtimeVersion, updateId, ...rest]
  if (segments.length < 5) {
    return sendJson(res, 400, {
      error: 'Expected /assets/<channel>/<runtimeVersion>/<updateId>/<file>.',
    });
  }
  const [, channel, runtimeVersion, updateId] = segments;
  if (![channel, runtimeVersion, updateId].every((s) => SEGMENT_RE.test(s))) {
    return sendJson(res, 400, { error: 'Invalid asset path.' });
  }

  const relPath = segments
    .slice(4)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/');

  const dir = path.join(DATA_DIR, channel, runtimeVersion, updateId);
  const abs = safeJoin(dir, relPath);
  if (!abs) return sendJson(res, 400, { error: 'Invalid asset path.' });

  let buffer;
  try {
    buffer = await fsp.readFile(abs);
  } catch {
    return sendJson(res, 404, { error: `Asset "${relPath}" does not exist.` });
  }

  const typeMap = await loadAssetTypeMap(dir);
  const declared = typeMap ? typeMap.get(relPath) : null;
  let contentType;
  if (declared && declared.isBundle) {
    contentType = 'application/javascript';
  } else if (declared && declared.ext) {
    contentType = MIME[String(declared.ext).toLowerCase()] || 'application/octet-stream';
  } else {
    const ext = path.extname(relPath).slice(1).toLowerCase();
    contentType = MIME[ext] || 'application/octet-stream';
  }

  res.writeHead(200, {
    'content-type': contentType,
    'content-length': buffer.length,
    // 资源路径里带 updateId，内容不可变，可以长缓存
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  res.end(buffer);
}

// ---------------------------------------------------------------- / 运维索引

async function handleIndex(res) {
  const channels = {};
  for (const channelEntry of await readdirSafe(DATA_DIR)) {
    if (!channelEntry.isDirectory() || !SEGMENT_RE.test(channelEntry.name)) continue;
    const channel = channelEntry.name;
    channels[channel] = {};
    const channelDir = path.join(DATA_DIR, channel);
    for (const runtimeEntry of await readdirSafe(channelDir)) {
      if (!runtimeEntry.isDirectory() || !SEGMENT_RE.test(runtimeEntry.name)) continue;
      const runtimeVersion = runtimeEntry.name;
      const pointer = await readJson(path.join(channelDir, runtimeVersion, 'current.json'));
      const history = (await readdirSafe(path.join(channelDir, runtimeVersion)))
        .filter((e) => e.isDirectory() && SEGMENT_RE.test(e.name))
        .map((e) => e.name)
        .sort();
      channels[channel][runtimeVersion] = {
        current: pointer ? pointer.updateId : null,
        createdAt: pointer ? pointer.createdAt || null : null,
        history,
      };
    }
  }
  return sendJson(res, 200, {
    service: 'jishiben-updates',
    publicBaseUrl: PUBLIC_BASE_URL,
    defaultChannel: DEFAULT_CHANNEL,
    channels,
  });
}

// ---------------------------------------------------------------- 路由

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Expected GET.' });
    }

    const url = new URL(req.url, 'http://internal.local');
    let pathname = url.pathname;
    // 经 nginx 反代时带 /updates 前缀，容器内直连时没有
    if (pathname === '/updates') pathname = '/';
    else if (pathname.startsWith('/updates/')) pathname = pathname.slice('/updates'.length);

    if (pathname === '/healthz') {
      const body = Buffer.from('ok\n');
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': body.length, 'cache-control': 'no-store' });
      return res.end(body);
    }

    // 客户端请求的是 updates.url 本身，路径形状不可控（GET /updates、/updates/、/manifest 都可能）。
    // 所以这几个入口只要带 expo-* 请求头就一律按 manifest 处理；不带头的（人/运维/探活）回索引。
    if (pathname === '/manifest' || pathname === '/manifest/') return await handleManifest(req, res, url);
    if (pathname === '/' || pathname === '') {
      const looksLikeClient = Boolean(req.headers['expo-platform'] || url.searchParams.get('platform'));
      return looksLikeClient ? await handleManifest(req, res, url) : await handleIndex(res);
    }
    if (pathname.startsWith('/assets/')) return await handleAsset(req, res, pathname);

    return sendJson(res, 404, { error: `Unknown path "${url.pathname}".` });
  } catch (error) {
    console.error('[updates] 请求处理失败', req.method, req.url, error);
    if (!res.headersSent) return sendJson(res, 500, { error: 'Internal server error.' });
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[updates] listening on :${PORT}  DATA_DIR=${DATA_DIR}  PUBLIC_BASE_URL=${PUBLIC_BASE_URL}  DEFAULT_CHANNEL=${DEFAULT_CHANNEL}`);
  fsp
    .stat(DATA_DIR)
    .then((st) => st.isDirectory())
    .catch(() => console.warn(`[updates] DATA_DIR 不存在（还没有任何更新）: ${DATA_DIR}`));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[updates] ${signal} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
