#!/bin/bash
# Script per installare i binari di sharp per Windows x64
# Necessario per build cross-platform da Linux a Windows

set -e

SHARP_VERSION=$(node -e "console.log(require('./node_modules/sharp/package.json').version)")
echo "Installazione @img/sharp-win32-x64@$SHARP_VERSION e @img/sharp-libvips-win32-x64..."

# Scarica e installa @img/sharp-win32-x64
npm pack "@img/sharp-win32-x64@$SHARP_VERSION" --silent
mkdir -p node_modules/@img/sharp-win32-x64
tar -xzf "img-sharp-win32-x64-$SHARP_VERSION.tgz" -C node_modules/@img/sharp-win32-x64 --strip-components=1
rm "img-sharp-win32-x64-$SHARP_VERSION.tgz"

echo "✅ Binari Windows di sharp installati correttamente."

