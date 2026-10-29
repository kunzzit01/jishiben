#!/usr/bin/env bash
# 发布一个 OTA 更新到本服务的数据目录。
#   真更新：   ./publish.sh -c preview -r 1.1.3 -d /path/to/expo-export-dist
#   假更新：   ./publish.sh -c preview -r 1.1.3 --fake
# 只做三件事：拷贝产物 → 写 current.json 指针 → 修正读权限。hash 由服务端按实际字节算。
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data_dir="${UPDATES_DATA_DIR:-$here/data}"

channel=""
runtime=""
update_id=""
src=""
fake=0

usage() {
  cat >&2 <<'USAGE'
用法: publish.sh -c <channel> -r <runtimeVersion> (-d <dist目录> | --fake) [-i <updateId>]
  -c, --channel   渠道名，如 preview / production
  -r, --runtime   运行时版本，如 1.1.3（必须与客户端 expo-runtime-version 一致）
  -d, --dist      expo export 产物目录（含 metadata.json / bundles/ / assets/）
      --fake      生成一个最小可下载的假更新，只用于验证 OTA 链路
  -i, --id        指定 updateId，默认 UTC 时间戳
USAGE
  exit "${1:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--channel) channel="${2:-}"; shift 2 || usage ;;
    -r|--runtime) runtime="${2:-}"; shift 2 || usage ;;
    -d|--dist)    src="${2:-}";     shift 2 || usage ;;
    -i|--id)      update_id="${2:-}"; shift 2 || usage ;;
    --fake)       fake=1; shift ;;
    -h|--help)    usage 0 ;;
    *) echo "未知参数: $1" >&2; usage 1 ;;
  esac
done

[ -n "$channel" ] || usage
[ -n "$runtime" ] || usage
if [ -z "$src" ] && [ "$fake" -eq 0 ]; then usage; fi

# 与 server.js 的 SEGMENT_RE 保持一致，避免发布出服务端不认的目录名
valid_segment() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; }
valid_segment "$channel" || { echo "非法 channel: $channel" >&2; exit 1; }
valid_segment "$runtime" || { echo "非法 runtimeVersion: $runtime" >&2; exit 1; }

[ -n "$update_id" ] || update_id="$(date -u +%Y%m%d%H%M%S)"
valid_segment "$update_id" || { echo "非法 updateId: $update_id" >&2; exit 1; }

base="$data_dir/$channel/$runtime"
dest="$base/$update_id"
created_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

rm -rf "$dest"
mkdir -p "$dest"

if [ "$fake" -eq 1 ]; then
  mkdir -p "$dest/bundles" "$dest/assets"
  for platform in android ios; do
    cat > "$dest/bundles/$platform-fake.js" <<JS
// 假更新启动包：只用于验证 OTA 链路，不含真实业务代码
globalThis.__JISHIBEN_FAKE_OTA__ = {
  channel: "$channel",
  runtimeVersion: "$runtime",
  updateId: "$update_id",
  publishedAt: "$created_at"
};
JS
  done
  # 1x1 透明 PNG（89 字节），让 manifest 的 assets 数组非空；
  # 用 printf '%b' + \xHH 写二进制，不依赖 base64/xxd 这类可能缺失的外部命令
  printf '%b' '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0d\x49\x44\x41\x54\x78\xda\x63\x64\xf8\xcf\x50\x0f\x00\x03\x86\x01\x80\x5a\x34\x7d\x6b\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82' > "$dest/assets/fake-asset.png"
  cat > "$dest/metadata.json" <<JSON
{
  "version": 0,
  "bundler": "metro",
  "fileMetadata": {
    "android": { "bundle": "bundles/android-fake.js", "assets": [{ "path": "assets/fake-asset.png", "ext": "png" }] },
    "ios": { "bundle": "bundles/ios-fake.js", "assets": [{ "path": "assets/fake-asset.png", "ext": "png" }] }
  }
}
JSON
  source_desc="fake"
else
  [ -f "$src/metadata.json" ] || { echo "$src 下没有 metadata.json，确认这是 expo export 的产物目录" >&2; exit 1; }
  cp -R "$src"/. "$dest"/
  source_desc="$src"
fi

# 原子替换指针：客户端任一时刻读到的都是完整的 current.json
cat > "$base/.current.json.tmp" <<JSON
{
  "updateId": "$update_id",
  "createdAt": "$created_at",
  "source": "$source_desc"
}
JSON
mv -f "$base/.current.json.tmp" "$base/current.json"

# 容器内以 node 用户（uid 1000）读文件，这里显式放开读权限
# （Windows/MSYS 没有 chmod，缺失时跳过即可，Linux 上必须执行）
if command -v chmod >/dev/null 2>&1; then
  chmod -R a+rX "$base"
fi

echo "已发布: channel=$channel runtimeVersion=$runtime updateId=$update_id"
echo "指针:   $base/current.json"
echo "目录:   $dest"
echo "验证:   curl -s -H 'expo-platform: android' -H 'expo-runtime-version: $runtime' -H 'expo-channel-name: $channel' https://187.127.125.136/updates/manifest"