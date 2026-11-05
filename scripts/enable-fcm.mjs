#!/usr/bin/env node
// enable-fcm.mjs —— 把 google-services.json 接进 app.json（幂等，可重复执行）
//
// 为什么需要脚本而不是手改：这个文件必须与 android.package 的包名严格一致，
// 手改容易漏；脚本会先校验包名，再写 app.json，避免出现「token 一直拿不到」的隐形错配。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const gsPath = path.join(root, 'google-services.json');
const appJsonPath = path.join(root, 'app.json');

if (!fs.existsSync(gsPath)) {
  console.error('[enable-fcm] 缺少 google-services.json —— 先按 docs/PUSH_FCM_SETUP.md 第 1 步下载并放到仓库根目录');
  process.exit(1);
}

let gs;
try {
  gs = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
} catch (e) {
  console.error('[enable-fcm] google-services.json 不是合法 JSON：' + e.message);
  process.exit(1);
}

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const expected = appJson?.expo?.android?.package;
const packages = (gs.client || []).map((c) => c?.client_info?.android_client_info?.package_name).filter(Boolean);

if (!expected) {
  console.error('[enable-fcm] app.json 里没有 expo.android.package，无法校验包名');
  process.exit(1);
}
if (!packages.includes(expected)) {
  console.error('[enable-fcm] 包名不匹配：google-services.json 里是 ' + JSON.stringify(packages) + '，app.json 要求 ' + expected);
  console.error('[enable-fcm] 回 Firebase 重新添加 Android 应用，包名填 ' + expected);
  process.exit(1);
}

appJson.expo.android = { ...(appJson.expo.android || {}), googleServicesFile: './google-services.json' };
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n', 'utf8');

console.log('[enable-fcm] OK：app.json 已写入 android.googleServicesFile = ./google-services.json（包名 ' + expected + '）');
console.log('[enable-fcm] 下一步：把 Firebase 服务账号私钥上传到 Expo（docs/PUSH_FCM_SETUP.md 第 3 步），然后 bash scripts/build-android-local.sh');
