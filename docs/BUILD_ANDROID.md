# Android 打包（EAS 云构建）

> 目标：产出一个可以直接装到安卓手机上的 **APK**。
> iOS 暂不做——需要 Apple Developer 账号（$99/年）才能出证书，等确定要上架再补。

---

## 0. 前置：先有后端地址

App 里的 API 地址是**构建期内联**的，所以打包前必须知道服务器地址：

```
EXPO_PUBLIC_API_BASE_URL = https://你的域名        ← 推荐（可上 HTTPS）
EXPO_PUBLIC_API_BASE_URL = http://1.2.3.4:8080    ← 临时可用，但安卓默认禁明文 HTTP
```

用 IP 直连时要额外打开明文：

```jsonc
// app.json → expo.android
"usesCleartextTraffic": true
```

用域名 + HTTPS 时保持 `false`（当前默认）。

---

## 1. 一次性准备

```bash
cd <仓库根>

# 登录 Expo（免费账号即可）
npx eas-cli login

# 把 API 地址写进 eas.json 的三个 profile（替换 REPLACE_ME_WITH_YOUR_DOMAIN）
#   或者在构建时用环境变量覆盖：
#   EXPO_PUBLIC_API_BASE_URL=https://api.example.com npx eas-cli build -p android --profile preview
```

---

## 2. 出 APK

```bash
npx eas-cli build -p android --profile preview
```

- `preview` profile：`distribution: internal` + `buildType: apk` → 产出 **APK**，构建完给一个下载链接/二维码，手机直接装。
- 首次构建 EAS 会问要不要生成 Android keystore，选 **Yes**（由 EAS 代管，之后复用）。

---

## 3. 安装与自检

装好后按顺序确认（这些是只能在真机验的部分）：

| 检查 | 预期 |
|---|---|
| 启动 | 出现登录页，不白屏 |
| 登录 | `mingsoon249@gmail.com` / `12345678`（若服务器是全新库，先注册） |
| 首页 | 净资产 / 本月预算 / 最近交易有数据 |
| 相机 | 「扫票」能拉起相机并拍照 |
| 相册 | 「收据」能选图 |
| 语音 | 录音后能识别（需服务端配了 OPENROUTER_API_KEY，否则提示降级） |
| 推送 | 首次进入会申请通知权限（不是必需） |

---

## 4. 版本迭代

```bash
# 改了代码后重新出包；versionCode 由 appVersionSource=remote 自动 +1
npx eas-cli build -p android --profile preview
```

---

## 5. 上架 Google Play（可选）

```bash
npx eas-cli build -p android --profile production     # 产出 AAB
npx eas-cli submit -p android                          # 需要 Play Console 账号 + 服务账号 JSON
```

---

## 常见问题

- **装完打开是白屏 / 一直转圈**：API 地址写错，或服务器没起来、HTTPS 证书无效。
- **登录报网络错误**：`usesCleartextTraffic` 与协议不匹配（http 需要 true，https 保持 false）。
- **相机打不开**：确认装的是本次构建的包（不是 Expo Go）；`expo-camera` 已配好权限文案。
- **构建失败提示 bundleIdentifier**：那是 iOS 的问题；Android 用 `android.package`，本项目已设为 `com.kylim0103.jizhangapp`。
