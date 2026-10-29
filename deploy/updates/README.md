# 自建 Expo Updates（OTA）服务

不依赖 Expo / EAS 云端，跑在自己的 VPS 上，给 `expo-updates` 客户端下发 OTA 更新。

- 零运行时依赖：只用 Node 标准库（`node:http` / `node:crypto` / `node:fs`），没有 `npm install`。
- 协议实现对齐官方参考实现 [expo/custom-expo-updates-server](https://github.com/expo/custom-expo-updates-server)。
- 容器 `jishiben-updates`，不发布宿主端口，只在内网被 `web` 容器的 nginx 反代。

## 客户端配置

```json
// app.json
{ "expo": { "updates": { "url": "https://187.127.125.136/updates" } } }
```

客户端实际请求的是 `https://187.127.125.136/updates/manifest`，带请求头：

| 请求头 | 说明 |
| --- | --- |
| `expo-platform` | `android` / `ios`，必填 |
| `expo-runtime-version` | 例 `1.1.3`，必填，对应存储目录名 |
| `expo-channel-name` | 例 `preview` / `production`；不传时用 `DEFAULT_CHANNEL` |
| `expo-protocol-version` | `0` 回纯 JSON，`1` 回 `multipart/mixed`（官方实现同款） |
| `expo-current-update-id` | 与当前版本一致且协议 v1 时回 `noUpdateAvailable` 指令 |

## 存储布局

```
data/<channel>/<runtimeVersion>/current.json          ← 指针：当前生效版本
data/<channel>/<runtimeVersion>/<updateId>/metadata.json
data/<channel>/<runtimeVersion>/<updateId>/expoConfig.json   （可选）
data/<channel>/<runtimeVersion>/<updateId>/bundles/*.js
data/<channel>/<runtimeVersion>/<updateId>/assets/*
```

`current.json` 形如 `{"updateId":"20251029153000","createdAt":"2025-10-29T15:30:00.000Z"}`。

- 回滚 = 把 `current.json` 改回旧的 `updateId`（旧的目录不删就一直在）。
- 指针缺失或指向不存在的目录时，退化为「按修改时间取最新一次发布」。

## 发布更新

```bash
# 1) 在构建机导出 OTA 产物（runtimeVersion 必须与客户端一致）
npx expo export --platform android

# 2) 发布到 VPS（dist 里应有 metadata.json / bundles/ / assets/）
./publish.sh -c preview -r 1.1.3 -d ./dist

# 3) 只做链路验证的假更新（自己生成一个最小可下载的包）
./publish.sh -c preview -r 1.1.3 --fake
```

`publish.sh` 只做三件事：拷贝产物 → 写 `current.json` 指针 → 修正读权限。它不参与计算 hash：服务端每次请求都按实际文件字节算 sha256，所以「声明的 hash」与「下载到的内容」永远一致。

## 协议细节（与参考实现一致）

| 字段 | 取值 |
| --- | --- |
| `id` | `sha256(updateId + ":" + metadata.json)` 的 hex 前 32 位切成 UUID |
| `createdAt` | 指针记录的发布时间（ISO 8601） |
| `launchAsset.hash` | `base64url(sha256(bundle 字节))`（`+`→`-`、`/`→`_`、去掉 `=`） |
| `launchAsset.key` | `md5(bundle 字节)` hex |
| `launchAsset.fileExtension` | `.bundle` |
| `launchAsset.contentType` | `application/javascript` |
| `assets[].fileExtension` | `.<ext>`，如 `.png` |
| 资源 URL | `https://187.127.125.136/updates/assets/<channel>/<runtimeVersion>/<updateId>/<相对路径>` |

> `id` 的算法相对参考实现多混入了 `updateId`：参考实现只哈希 `metadata.json`，
> 若两次发布产出同名 bundle（元数据完全相同）会得到同一个 id，客户端会误判成「已是最新」。

## 本地自测

```bash
DATA_DIR=./data PUBLIC_BASE_URL=https://187.127.125.136/updates PORT=8081 node server.js
curl -s -H 'expo-platform: android' -H 'expo-runtime-version: 1.1.3' -H 'expo-channel-name: preview' \
  http://127.0.0.1:8081/updates/manifest | python3 -m json.tool
```

## 运维

```bash
docker compose -f deploy/docker-compose.yml up -d --build updates   # 首次/改动后
docker compose -f deploy/docker-compose.yml restart updates         # 重启（数据在宿主机，不丢）
curl -s https://187.127.125.136/updates/                            # 各 channel 当前指向
```

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8081` | 容器内监听端口 |
| `DATA_DIR` | `/data` | 更新包根目录 |
| `PUBLIC_BASE_URL` | `https://187.127.125.136/updates` | manifest 里 URL 的绝对前缀，必须与 `updates.url` 一致 |
| `DEFAULT_CHANNEL` | `production` | 客户端没带 `expo-channel-name` 时用 |
