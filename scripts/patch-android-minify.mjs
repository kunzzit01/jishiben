import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 开启 release 的代码/资源压缩。android/ 由 expo prebuild 生成且被 gitignore，
// 所以每次构建后都要重新打补丁（与 patch-android-signing.mjs 同一思路）。
// 效果：R8 收缩 + 去掉未引用资源 + 只保留中英文资源 → APK 体积明显下降。
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const gradleProps = join(androidDir, 'gradle.properties');
const appGradle = join(androidDir, 'app', 'build.gradle');
const proguard = join(androidDir, 'app', 'proguard-rules.pro');

if (!existsSync(gradleProps) || !existsSync(appGradle)) {
  console.error('[minify] android project missing. Run: npx expo prebuild -p android');
  process.exit(1);
}

function setProp(props, key, value) {
  const re = new RegExp('^' + key + '=.*$', 'm');
  if (re.test(props)) return props.replace(re, key + '=' + value);
  return props.replace(/\s*$/, '') + '\n' + key + '=' + value + '\n';
}

let props = readFileSync(gradleProps, 'utf8');
props = setProp(props, 'android.enableMinifyInReleaseBuilds', 'true');
props = setProp(props, 'android.enableShrinkResourcesInReleaseBuilds', 'true');
writeFileSync(gradleProps, props);

let gradle = readFileSync(appGradle, 'utf8');
if (!gradle.includes('resConfigs')) {
  gradle = gradle.replace(
    '    androidResources {',
    '    defaultConfig {\n' +
      '        // 只保留中英文资源（砍掉其它语言，减小 res 体积）\n' +
      '        resConfigs "zh", "en"\n' +
      '    }\n' +
      '    androidResources {'
  );
  writeFileSync(appGradle, gradle);
}

const KEEP = [
  '',
  '# ---- jishiben: R8 keep rules（scripts/patch-android-minify.mjs 注入）----',
  '-keep class com.shopify.reactnative.skia.** { *; }',
  '-keep class com.facebook.jni.** { *; }',
  '-keep class com.facebook.react.** { *; }',
  '-keep class com.facebook.hermes.** { *; }',
  '-keep class com.reactnativegooglesignin.** { *; }',
  '-keep class expo.modules.** { *; }',
  '-keep class com.google.mlkit.** { *; }',
  '-keepattributes *Annotation*, InnerClasses, Signature, Exceptions',
  '-dontwarn okhttp3.**',
  '-dontwarn okio.**',
  '-dontwarn com.shopify.**',
  '-dontwarn expo.**',
  ''
].join('\n');

if (existsSync(proguard)) {
  const cur = readFileSync(proguard, 'utf8');
  if (!cur.includes('jishiben: R8 keep rules')) writeFileSync(proguard, cur + KEEP);
}
console.log('[minify] release minify+shrink enabled (resConfigs zh/en)');
