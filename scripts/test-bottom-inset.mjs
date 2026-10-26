#!/usr/bin/env node
/**
 * 底部系统栏 inset 公式的数学回归测试（不依赖真机）。
 *
 * 为什么需要它：Android 上「导航栏高度」无法在 CI / Web 里直接测，
 * 但这套公式的错误会稳定复现成错误数值（旧公式在键盘弹起时算出 348），
 * 所以用真源码编译后跑断言，比人工推理可靠。
 *
 * 用法：node scripts/test-bottom-inset.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src/hooks/bottomSystemInsetCore.ts');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inset-test-'));

fs.copyFileSync(src, path.join(out, 'bottomSystemInsetCore.ts'));
execFileSync(process.execPath, [tsc, 'bottomSystemInsetCore.ts', '--module', 'es2022', '--target', 'es2022', '--moduleResolution', 'bundler'], { cwd: out, stdio: 'inherit' });

const { computeBottomSystemInset } = await import('file://' + path.join(out, 'bottomSystemInsetCore.js').replace(/\\/g, '/'));

const cases = [
  ['安卓三键 edge-to-edge',        { platform: 'android', insetsBottom: 48, screenHeight: 800, windowHeight: 800, statusBarHeight: 24, keyboardVisible: false }, 48],
  ['安卓手势 edge-to-edge',        { platform: 'android', insetsBottom: 24, screenHeight: 800, windowHeight: 800, statusBarHeight: 24, keyboardVisible: false }, 24],
  ['三键 + 键盘(窗口-300)',        { platform: 'android', insetsBottom: 48, screenHeight: 800, windowHeight: 500, statusBarHeight: 24, keyboardVisible: true }, 48],
  ['OEM 漏报 inset + 窗口切 48',   { platform: 'android', insetsBottom: 0,  screenHeight: 800, windowHeight: 728, statusBarHeight: 24, keyboardVisible: false }, 48],
  ['OEM 漏报 + 键盘(混入 348)',    { platform: 'android', insetsBottom: 0,  screenHeight: 800, windowHeight: 428, statusBarHeight: 24, keyboardVisible: true }, 0],
  ['OEM 漏报 + 分屏压缩 200',      { platform: 'android', insetsBottom: 0,  screenHeight: 800, windowHeight: 576, statusBarHeight: 24, keyboardVisible: false }, 0],
  ['iOS 刘海(Home Indicator 34)',   { platform: 'ios',     insetsBottom: 34, screenHeight: 844, windowHeight: 844, statusBarHeight: 0,  keyboardVisible: false }, 34],
  ['iOS iPhone SE(无 Home 条)',      { platform: 'ios',     insetsBottom: 0,  screenHeight: 667, windowHeight: 667, statusBarHeight: 0,  keyboardVisible: false }, 0],
  ['iOS iPad(20)',                  { platform: 'ios',     insetsBottom: 20, screenHeight: 1024, windowHeight: 1024, statusBarHeight: 0, keyboardVisible: false }, 20],
  ['iOS 键盘弹起(窗口不变)',         { platform: 'ios',     insetsBottom: 34, screenHeight: 844, windowHeight: 844, statusBarHeight: 0,  keyboardVisible: true }, 34],
  ['Web',                          { platform: 'web',     insetsBottom: 0,  screenHeight: 900, windowHeight: 900, statusBarHeight: 0,  keyboardVisible: false }, 0],
  ['负值保护',                     { platform: 'android', insetsBottom: -5, screenHeight: 800, windowHeight: 800, statusBarHeight: 0,  keyboardVisible: false }, 0],
  ['旧公式算 348 的回归项',        { platform: 'android', insetsBottom: 0,  screenHeight: 800, windowHeight: 428, statusBarHeight: 24, keyboardVisible: false }, 0],
];

let fail = 0;
for (const [name, input, want] of cases) {
  const got = computeBottomSystemInset(input);
  const ok = Math.abs(got - want) < 0.5;
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + String(name).padEnd(28) + '→ ' + got + ' (期望 ' + want + ')');
}
fs.rmSync(out, { recursive: true, force: true });
console.log('');
console.log(fail === 0 ? '全部 ' + cases.length + ' 条通过' : fail + ' 条失败');
process.exit(fail === 0 ? 0 : 1);
