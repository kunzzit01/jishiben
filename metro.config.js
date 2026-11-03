// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo 的 metro-file-map fork 默认 useWatchman=false，没有 watchman 时会退回
// FallbackWatcher——它在 Windows 上监听到临时文件（如 .mimosa 的会话锁）被删除时
// 会抛 ENOENT 使整个 dev server 崩溃。本机已安装 watchman，这里显式启用。
config.resolver.useWatchman = true;

// 另一个进程（自检脚本等）会在 scripts/ 下建「.xxx.tmpdir」然后立刻删掉。
// FallbackWatcher 在 crawler 访问这些已消失的路径时会抛 ENOENT，把整个 dev server 带崩；
// 这类临时产物不进文件图就不会被监听到（App 从不 import scripts/）。
const inherited = config.resolver.blockList;
const base = Array.isArray(inherited) ? inherited : inherited ? [inherited] : [];
config.resolver.blockList = [
  ...base,
  /\/scripts\/\.[^/]+$/, // scripts 下以点开头的临时文件 / 目录
  /\.tmpdir$/,
];

module.exports = config;
