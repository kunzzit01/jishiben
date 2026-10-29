#!/usr/bin/env bash
# Rebuild the jizhang-app release APK locally (no EAS / no Expo cloud).
#
# Why a "shadow" build root: this repo lives under a long OneDrive path, and the CMake
# paths Android generates for prefab (.cxx/<cfg>/<hash>/<abi>/../prefab/...) exceed
# Windows' 260-char MAX_PATH. ninja then cannot stat them and fails forever with
# "manifest 'build.ninja' still dirty after 100 tries". Building the same sources from
# a short root (C:\jzsrc) keeps every path under the limit.
#
# Signing credentials live in ~/.gradle/gradle.properties + ~/.jishiben-keys (outside this repo).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHADOW="${JZ_SHADOW:-/c/jzsrc}"
RN_ARCHS="${RN_ARCHS:-arm64-v8a}"

SDK="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

# Inlined at bundle time, so it must be set for expo export/bundleRelease, not just gradle.
: "${EXPO_PUBLIC_API_BASE_URL:=https://187.127.125.136}"
export EXPO_PUBLIC_API_BASE_URL

echo "[build] repo    = $ROOT"
echo "[build] shadow  = $SHADOW"
echo "[build] SDK     = $SDK"
echo "[build] API URL = $EXPO_PUBLIC_API_BASE_URL"
echo "[build] ABIs    = $RN_ARCHS"

# 1) NDK + CMake (idempotent)
NDK_VERSION=27.1.12297006   # must match node_modules/react-native/gradle/libs.versions.toml
if [ ! -d "$SDK/ndk/$NDK_VERSION" ] || [ ! -d "$SDK/cmake/3.22.1" ]; then
  echo "[build] installing NDK $NDK_VERSION + CMake 3.22.1"
  "$SDK/cmdline-tools/latest/bin/sdkmanager.bat" --install "ndk;$NDK_VERSION" "cmake;3.22.1" < /dev/null
fi

# 2) Signing properties must exist before compiling
if ! grep -q '^JIZHANG_STORE_FILE=' "$HOME/.gradle/gradle.properties" 2>/dev/null; then
  echo "[build] ERROR: JIZHANG_* signing properties missing in ~/.gradle/gradle.properties" >&2
  echo "[build]        Need JIZHANG_STORE_FILE / JIZHANG_STORE_PASSWORD / JIZHANG_KEY_ALIAS / JIZHANG_KEY_PASSWORD" >&2
  exit 1
fi

# 3) Sync sources into the short build root
if [ ! -d "$SHADOW/node_modules" ] || [ ! -f "$SHADOW/.jz-deps-stamp" ] || [ "$ROOT/package-lock.json" -nt "$SHADOW/.jz-deps-stamp" ]; then
  echo "[build] full sync (dependencies changed or first run)"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(printf '%s' "$ROOT/scripts/sync-to-shadow.ps1" | sed 's|^/\([a-zA-Z]\)/|\1:\\|; s|/|\\|g')" -Source "$(printf '%s' "$ROOT" | sed 's|^/\([a-zA-Z]\)/|\1:\\|; s|/|\\|g')" -Destination "$(printf '%s' "$SHADOW" | sed 's|^/\([a-zA-Z]\)/|\1:\\|; s|/|\\|g')"
  touch "$SHADOW/.jz-deps-stamp"
else
  echo "[build] incremental source sync"
  tar -C "$ROOT" -cf - \
    --exclude=.git --exclude=_scratch --exclude=node_modules \
    --exclude=android --exclude=ios --exclude=design --exclude=.expo \
    . | tar -C "$SHADOW" -xf -
fi

# 4) Native project. Regenerate when missing or when app.json changed (OTA URL etc.).
if [ ! -d "$SHADOW/android" ] || [ "$ROOT/app.json" -nt "$SHADOW/android" ]; then
  echo "[build] running expo prebuild in shadow root"
  ( cd "$SHADOW" && npx expo prebuild -p android )
fi

# 5) Gradle SDK pointer + release signing wiring (both idempotent)
printf 'sdk.dir=%s\n' "$(printf '%s' "$SDK" | tr '\\' '/')" > "$SHADOW/android/local.properties"
( cd "$SHADOW" && node scripts/patch-android-signing.mjs )

# 6) Build
( cd "$SHADOW/android" && ./gradlew.bat assembleRelease -PreactNativeArchitectures="$RN_ARCHS" )

SRC_APK="$SHADOW/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$SRC_APK" ] || { echo "[build] ERROR: no APK at $SRC_APK" >&2; exit 1; }

# 7) Publish the APK back into the repo (android/ is gitignored)
mkdir -p "$ROOT/android/app/build/outputs/apk/release"
cp "$SRC_APK" "$ROOT/android/app/build/outputs/apk/release/app-release.apk"

echo "[build] APK: $ROOT/android/app/build/outputs/apk/release/app-release.apk"
ls -l "$ROOT/android/app/build/outputs/apk/release/app-release.apk"
