#!/bin/bash
# Build script for numr-web

set -e

# Use rustup toolchain (not Homebrew)
export PATH="$HOME/.cargo/bin:$PATH"

# Navigate to the workspace root
cd "$(dirname "$0")/.."

# Clean previous build
rm -rf numr-web/pkg

echo "Building numr-core for WASM..."
wasm-pack build crates/numr-core \
    --target web \
    --out-dir ../../numr-web/pkg/core \
    --features wasm

echo ""
echo "Building numr-editor for WASM..."
wasm-pack build crates/numr-editor \
    --target web \
    --out-dir ../../numr-web/pkg/editor \
    --features wasm

echo ""
echo "Stamping asset versions..."
node numr-web/scripts/stamp-asset-versions.mjs

echo ""
echo "Build complete! Files are in numr-web/pkg/"
echo ""
echo "To serve locally:"
echo "  cd numr-web && python3 -m http.server 8080"
echo ""
echo "Then open http://localhost:8080 in your browser."
