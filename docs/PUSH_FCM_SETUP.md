# 远程推送（FCM）接入步骤

> 目标：让「管理员广播」能把通知真正推到所有设备。
> 现状：`push_tokens` 恒为 0 —— 安装包里没有 FCM 配置，`getExpoPushTokenAsync()` 必然失败。
> 注意：**本地提醒**（21:00 记一笔 / 测试通知）不依赖 FCM，一直可用；只有**跨设备推送**需要它。

## 0. 为什么需要 google-services.json

| 通道 | 依赖 |
|---|---|
| 本地通知（手机自己排的闹钟） | 无 |
| 远程推送 Android | **FCM**（Firebase Cloud Messaging） |
| 远程推送 iOS | APNs（本次不涉及） |

`google-services.json` 是 Firebase 生成的 Android 客户端配置（含 `project_id` / `mobilesdk_app_id` / `api_key` + 包名），
**不是登录凭据，也不是第三方登录**。

## 1. 建 Firebase 项目并下载配置（你操作）

1. 打开 https://console.firebase.google.com → 新建项目（名字随意，例如 `jizhang-app`）
2. 项目里「添加应用」→ **Android**
3. **Android 包名必须填**：`com.kylim0103.jizhangapp`（与 `app.json` 的 `android.package` 一致，填错 token 拿不到）
4. 下载 `google-services.json`，放到仓库根目录：`_repo/jishiben/google-services.json`
5. 回来告诉我「文件放好了」

## 2. 让工程引用它（我操作，一条命令）

```bash
node scripts/enable-fcm.mjs
```
它会校验文件里的包名，然后把 `app.json` 补成：
```json
"android": { "googleServicesFile": "./google-services.json" }
```

## 3. 把 FCM 服务端凭据交给 Expo（你操作，必须）

Expo 的推送服务要用它去调 FCM，**否则 token 能拿到但投递失败**：

1. Firebase → 项目设置 → **服务账号** → 生成新的私钥（下载 JSON）
2. 打开 https://expo.dev → 你的项目 → **Credentials** → Android → **FCM V1 service account key** → 上传刚才那个 JSON
   - 或用命令行：`eas credentials` → Android → Push Notifications → FCM V1
3. 这个私钥**只给 Expo**，不要提交进仓库、不要发给我

## 4. 重新出包（我操作）

```bash
bash scripts/build-android-local.sh
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

- 本机已有 JDK 21 + Android SDK（`%LOCALAPPDATA%\Android\Sdk`），可直接本地构建
- 若 `~/.gradle/gradle.properties` 里没有 `JIZHANG_STORE_FILE/…` 四项，release 会用 **debug keystore** 签名：
  测试机可装，但**必须先卸载旧版**（签名不同会装不上）；正式上架请提供 release keystore

## 5. 验证（按顺序）

| 检查 | 期望 |
|---|---|
| 安装新包 → 打开 App → 允许通知 | 提醒设置 → 「注册推送 token（排查用）」显示 `已注册并上报后端：ExponentPushToken[...]` |
| 服务端 | `select count(*) from push_tokens;` > 0 |
| 管理员点「给所有设备发一条通知」 | 显示 `已发送 N/N` |
| 其他设备 | 锁屏/通知栏收到系统通知 |

## 常见失败对照

| UI 显示 | 含义 | 处理 |
|---|---|---|
| `getExpoPushTokenAsync 失败：Default FirebaseApp is not initialized` | 包里没有 google-services.json | 回到第 1 步 |
| `getExpoPushTokenAsync 失败：…InvalidCredentials…` | Expo 没有 FCM 服务账号 | 第 3 步 |
| `权限未授予` | 系统通知被关 | 系统设置 → 应用 → 记账 → 通知 |
| 广播 `已发送 0/0` | 库里没有 token | 每台设备先按第 5 步注册 |
