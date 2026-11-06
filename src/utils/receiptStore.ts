// receiptStore.ts —— 凭证图片的本地落盘 + "本地 uri / 服务端相对路径"两种形态的统一解析。
//
// 背景：相机/相册返回的是 cache 目录里的临时 uri，清缓存或换机就破图。拍照拿到 uri 后立刻
// 复制进 documentDirectory/receipts/，本地记录的就是这份持久 uri；同步时再把文件上传到
// 服务端，本地只保留服务端返回的 receipts/xxx.jpg（相对路径）。
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '../config/apiConfig';

/** 服务端返回的凭证相对路径前缀（后端契约：receipts/xxx.jpg） */
const REMOTE_PREFIX = 'receipts/';
/** 持久目录：/document/receipts/（web 上没有 documentDirectory，为空串，落盘直接失败兜底） */
const RECEIPTS_DIR = (FileSystem.documentDirectory ?? '') + 'receipts/';
/** 带协议的 uri（file/content/http...）一律不是服务端相对路径 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const LOCAL_SCHEME_RE = /^(file|content):/i;

function normalize(path: string): string {
  return path.replace(/^\/+/, '');
}

/** 是不是服务端相对路径（receipts/xxx.jpg；file:// / content:// / http(s):// 都不算） */
export function isRemoteReceipt(path?: string | null): boolean {
  if (!path) return false;
  if (SCHEME_RE.test(path)) return false;
  const clean = normalize(path);
  return clean.startsWith(REMOTE_PREFIX) && clean.length > REMOTE_PREFIX.length;
}

/** 渲染用 <Image source={{ uri }}>：本地 uri 原样返回，服务端相对路径拼成可访问的 URL */
export function receiptImageSource(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (!isRemoteReceipt(path)) return path;
  return API_BASE_URL + '/api/receipts/' + normalize(path).slice(REMOTE_PREFIX.length);
}

function fileExtension(uri: string): string {
  const bare = uri.split('?')[0].split('#')[0];
  const match = /\.([a-z0-9]{2,5})$/i.exec(bare);
  const ext = match ? match[1].toLowerCase() : '';
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext) ? ext : 'jpg';
}

/** 文件名用 uuid（老 Hermes 没有 randomUUID 时退回时间戳 + 随机串） */
function randomId(): string {
  try {
    const maybe = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (maybe?.randomUUID) return maybe.randomUUID();
  } catch {
    // 走下面的兜底
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 把相机/相册给的临时图片复制到 documentDirectory/receipts/，返回新 uri。
 * 任何失败都原样返回入参：凭证落不了盘也不能让用户记不了账。
 */
export async function persistReceiptImage(uri: string): Promise<string> {
  if (!uri) return uri;
  // 已经是服务端相对路径 / 已经落在持久目录里：不用再复制一份
  if (isRemoteReceipt(uri) || uri.startsWith(RECEIPTS_DIR)) return uri;
  if (!FileSystem.documentDirectory) return uri;
  try {
    await FileSystem.makeDirectoryAsync(RECEIPTS_DIR, { intermediates: true });
    const dest = RECEIPTS_DIR + randomId() + '.' + fileExtension(uri);
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (e) {
    console.warn('[receipt] 凭证落盘失败，继续用临时 uri：', e);
    return uri;
  }
}

/** 本地文件还在不在（服务端相对路径 / http / data 一律视为不在本机） */
export async function localReceiptExists(uri: string): Promise<boolean> {
  if (!uri || !LOCAL_SCHEME_RE.test(uri)) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}
