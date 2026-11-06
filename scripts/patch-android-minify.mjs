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
// ML Kit 文本识别会带 5 种文字模型（latin/chinese/devanagari/japanese/korean，各约 3MB）。
// 我们只用中文（小票/转账截图都是中英混排），排除其余三种可省约 9MB。
if (!gradle.includes('text-recognition-japanese')) {
  const EXCLUDES = [
    "configurations.all {",
    "    exclude group: 'com.google.mlkit', module: 'text-recognition-devanagari'",
    "    exclude group: 'com.google.mlkit', module: 'text-recognition-japanese'",
    "    exclude group: 'com.google.mlkit', module: 'text-recognition-korean'",
    "}",
    ""
  ].join('\n');
  gradle = gradle.replace('android {', EXCLUDES + 'android {');
  writeFileSync(appGradle, gradle);
}

// 端侧 Gemini Nano（com.google.mlkit:genai-prompt:1.0.0-beta5）的 POM 把 kotlin-stdlib 抬到 2.4.0，
// 而本 SDK 的 Kotlin 编译器（rootProject.ext.kotlinVersion = 2.1.20）只能读 metadata <= 2.2.0，
// 结果 :app:compileReleaseKotlin 直接报 "Incompatible classes were found in dependencies"。
// stdlib 向下 ABI 兼容，这里统一压回编译器自带的版本。
if (!gradle.includes('jishiben: kotlin-stdlib 版本压制')) {
  const KOTLIN_FORCE = [
    "configurations.all {",
    "    // jishiben: kotlin-stdlib 版本压制（由 patch-android-minify.mjs 注入）",
    "    resolutionStrategy.eachDependency { details ->",
    "        if (details.requested.group == 'org.jetbrains.kotlin' && details.requested.name.startsWith('kotlin-stdlib')) {",
    "            details.useVersion(rootProject.ext.has('kotlinVersion') ? rootProject.ext.get('kotlinVersion') : '2.1.20')",
    "        }",
    "    }",
    "}",
    ""
  ].join('\n');
  gradle = gradle.replace('android {', KOTLIN_FORCE + 'android {');
  writeFileSync(appGradle, gradle);
}

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
  // 原生 OCR 桥（@react-native-ml-kit/text-recognition）：类与 @ReactMethod 都必须保留
  '-keep class com.rnmlkit.** { *; }',
  // 端侧 Gemini Nano 桥（modules/react-native-gemini-nano）：PackageList 反射实例化 Package，
  // @ReactMethod 也要靠反射暴露给 JS，整包保留
  '-keep class com.gemini.nano.** { *; }',
  '-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }',
  '-keep @com.facebook.react.bridge.ReactModuleSpec class * { *; }',
  '-keep class expo.modules.** { *; }',
  '-keep class com.google.mlkit.** { *; }',
  '-keepattributes *Annotation*, InnerClasses, Signature, Exceptions',
  '-dontwarn okhttp3.**',
  '-dontwarn okio.**',
  '-dontwarn com.shopify.**',
  '-dontwarn expo.**',
  '-dontwarn com.google.mlkit.vision.text.devanagari.**',
  '-dontwarn com.google.mlkit.vision.text.japanese.**',
  '-dontwarn com.google.mlkit.vision.text.korean.**',
  ''
].join('\n');

// 单独保证 Gemini Nano 桥的 keep：shadow 里的 android/ 往往已存在旧版规则块，
// 上面那几个分支都不会命中，所以这里用「标记缺失才追加」的幂等写法。
function ensureKeepRule(needle, block) {
  if (!existsSync(proguard)) return;
  const current = readFileSync(proguard, 'utf8');
  if (!current.includes(needle)) {
    writeFileSync(proguard, current.replace(/\s*$/, '') + '\n' + block);
  }
}

ensureKeepRule(
  'com.gemini.nano.**',
  [
    '',
    '# ---- jishiben: 端侧 Gemini Nano 桥（modules/react-native-gemini-nano）----',
    '-keep class com.gemini.nano.** { *; }',
    ''
  ].join('\n')
);

if (existsSync(proguard)) {
  const cur = readFileSync(proguard, 'utf8');
  if (!cur.includes('jishiben: R8 keep rules')) {
    writeFileSync(proguard, cur + KEEP);
  } else if (!cur.includes('com.rnmlkit.**')) {
    const EXTRA_OCR = [
      '-keep class com.rnmlkit.** { *; }',
      '-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }',
      ''
    ].join('\n');
    writeFileSync(proguard, cur + EXTRA_OCR);
  } else if (!cur.includes('devanagari.**')) {
    // 曾经注入过旧版规则：补上后来新增的 dontwarn（排除掉的三套 MLKit 模型仍被模块引用）
    const EXTRA = [
      '-dontwarn com.google.mlkit.vision.text.devanagari.**',
      '-dontwarn com.google.mlkit.vision.text.japanese.**',
      '-dontwarn com.google.mlkit.vision.text.korean.**',
      ''
    ].join('\n');
    writeFileSync(proguard, cur + EXTRA);
  }
}
console.log('[minify] release minify+shrink enabled (resConfigs zh/en)');
