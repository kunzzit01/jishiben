#!/usr/bin/env bash
# 发布 OTA 前的强制自检：确认 bundle 里确实包含原生依赖的 JS 模块。
# 事故背景（2026-11-06）：VPS 的 node_modules 未安装新增的
# @react-native-ml-kit/text-recognition，expo export 依然成功，
# 但产物里该 require 运行时抛错 -> 扫票永远提示「需要更新 App」。
# 结论：export 成功 != 依赖打进包，必须验证 bundle 内容。
set -euo pipefail
HBC=${1:?usage: check-ota-bundle.sh <index-*.hbc>}
[ -f "$HBC" ] || { echo "[check] not found: $HBC" >&2; exit 1; }
fail=0
check() {
  local needle="$1" label="$2" count
  count=$(grep -c "$needle" "$HBC" 2>/dev/null || true)
  if [ "${count:-0}" -ge 1 ]; then
    echo "[check] OK   $label"
  else
    echo "[check] FAIL $label (missing: $needle)" >&2
    fail=1
  fi
}
check "seem to be linked" "ML Kit text-recognition JS module"
check "Devanagari"        "ML Kit TextRecognitionScript enum"
if [ "$fail" -ne 0 ]; then
  echo "[check] bundle lacks dependency -> run npm install, then re-export" >&2
  exit 1
fi
echo "[check] pass: safe to publish"
