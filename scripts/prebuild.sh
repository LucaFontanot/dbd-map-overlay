#!/usr/bin/env bash
# prebuild.sh — Scarica binari nativi cross-platform per la build Electron.
# Eseguito automaticamente prima di electron-builder.
#
# Gestisce:
#   - sharp: binari Windows (.dll) da @img/sharp-win32-x64 e @img/sharp-libvips-win32-x64
#   - node-screenshots: .node NAPI-RS per win32/linux (tranne la piattaforma corrente)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

NODE_SCREENSHOTS_VERSION="0.2.8"
TARGET_DIR="node_modules/node-screenshots"
REGISTRY="https://registry.npmjs.org"

# Mappa: triple NAPI -> nome pacchetto npm
declare -A NPM_PACKAGES=(
  ["win32-x64-msvc"]="node-screenshots-win32-x64-msvc"
  ["win32-ia32-msvc"]="node-screenshots-win32-ia32-msvc"
  ["win32-arm64-msvc"]="node-screenshots-win32-arm64-msvc"
  ["linux-x64-gnu"]="node-screenshots-linux-x64-gnu"
  ["linux-x64-musl"]="node-screenshots-linux-x64-musl"
  ["linux-arm64-gnu"]="node-screenshots-linux-arm64-gnu"
  ["darwin-x64"]="node-screenshots-darwin-x64"
  ["darwin-arm64"]="node-screenshots-darwin-arm64"
)

# Mappa piattaforma -> triples
declare -A PLATFORM_TRIPLES=(
  ["win32"]="win32-x64-msvc win32-ia32-msvc win32-arm64-msvc"
  ["linux"]="linux-x64-gnu linux-x64-musl linux-arm64-gnu"
  ["darwin"]="darwin-x64 darwin-arm64"
)

###############################################################################
# sharp — Windows x64
###############################################################################
install_sharp_win() {
  local SHARP_VERSION
  SHARP_VERSION=$(node -e "console.log(require('./node_modules/sharp/package.json').version)")

  for pkg in "@img/sharp-win32-x64" "@img/sharp-libvips-win32-x64"; do
    local dir="node_modules/${pkg}"
    if [ -d "$dir" ] && [ "$(ls -A "$dir" 2>/dev/null)" ]; then
      echo "[sharp] $pkg già presente, skip"
      continue
    fi

    echo "[sharp] Download $pkg@$SHARP_VERSION..."
    local tarball
    tarball=$(npm pack "$pkg@$SHARP_VERSION" --silent --pack-destination /tmp 2>/dev/null)
    mkdir -p "$dir"
    tar -xzf "/tmp/$tarball" -C "$dir" --strip-components=1
    rm -f "/tmp/$tarball"
    echo "  OK"
  done
}

###############################################################################
# node-screenshots — NAPI-RS .node binaries
###############################################################################
install_node_screenshots() {
  local triple="$1"
  local pkg="${NPM_PACKAGES[$triple]:-}"
  if [ -z "$pkg" ]; then
    echo "[node-screenshots] Triple sconosciuto: $triple, skip"
    return 0
  fi

  local filename="node-screenshots.${triple}.node"
  local dest="$TARGET_DIR/$filename"
  local tarball="/tmp/${pkg}-${NODE_SCREENSHOTS_VERSION}.tgz"
  local url="${REGISTRY}/${pkg}/-/${pkg}-${NODE_SCREENSHOTS_VERSION}.tgz"

  echo "[node-screenshots] $pkg -> $filename"

  if ! curl -fsSL "$url" -o "$tarball"; then
    echo "  ERRORE: download fallito da $url"
    return 1
  fi

  mkdir -p "$TARGET_DIR"
  if ! tar -xzf "$tarball" --strip-components=1 -C "$TARGET_DIR" "package/${filename}" 2>/dev/null; then
    echo "  ERRORE: estrazione fallita"
    rm -f "$tarball"
    return 1
  fi

  rm -f "$tarball"

  if [ -f "$dest" ]; then
    local size_kb
    size_kb=$(du -k "$dest" | cut -f1)
    echo "  OK (${size_kb} KB)"
  else
    echo "  ERRORE: file non trovato dopo estrazione"
    return 1
  fi
}

should_skip_triple() {
  local triple="$1"
  shift
  local current_triples=("$@")

  for ct in "${current_triples[@]}"; do
    if [ "$triple" = "$ct" ]; then
      return 0
    fi
  done

  local filename="node-screenshots.${triple}.node"
  if [ -f "$TARGET_DIR/$filename" ]; then
    return 0
  fi

  return 1
}

###############################################################################
# Main
###############################################################################

echo "=== prebuild: download binari nativi cross-platform ==="
echo ""

# Sharp
install_sharp_win

echo ""

# Determina piattaforma corrente per skip
CURRENT_ARCH=$(node -e "console.log(process.arch)")
CURRENT_PLATFORM=$(node -e "console.log(process.platform)")
CURRENT_TRIPLES=()

if [ "$CURRENT_PLATFORM" = "linux" ]; then
  LIBC="gnu"
  if [ -f /usr/bin/ldd ] && grep -q musl /usr/bin/ldd 2>/dev/null; then
    LIBC="musl"
  fi
  CURRENT_TRIPLES+=("linux-${CURRENT_ARCH}-${LIBC}")
elif [ "$CURRENT_PLATFORM" = "win32" ]; then
  CURRENT_TRIPLES+=("win32-${CURRENT_ARCH}-msvc")
elif [ "$CURRENT_PLATFORM" = "darwin" ]; then
  CURRENT_TRIPLES+=("darwin-${CURRENT_ARCH}")
fi

# Raccogli triples richiesti
REQUESTED=("${@}")
if [ ${#REQUESTED[@]} -eq 0 ]; then
  REQUESTED=("win32" "linux")
fi

TRIPLES=()
for plat in "${REQUESTED[@]}"; do
  if [ -n "${PLATFORM_TRIPLES[$plat]:-}" ]; then
    for t in ${PLATFORM_TRIPLES[$plat]}; do
      TRIPLES+=("$t")
    done
  else
    TRIPLES+=("$plat")
  fi
done

# Scarica node-screenshots binaries
FAILED=0
for triple in "${TRIPLES[@]}"; do
  if should_skip_triple "$triple" "${CURRENT_TRIPLES[@]}"; then
    echo "[node-screenshots] $triple skip (già presente o piattaforma corrente)"
    continue
  fi

  if ! install_node_screenshots "$triple"; then
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "=== prebuild completato ==="
else
  echo "=== prebuild completato con $FAILED errori ==="
  exit 1
fi
