#!/usr/bin/env bash
# LuminaHDR Standalone Launcher for Linux & macOS
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required to run LuminaHDR."
    echo "Please install Node.js 20+ from https://nodejs.org"
    exit 1
fi

# Ensure dependencies installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing lightweight dependencies..."
    npm install --omit=dev
fi

# Run LuminaSync if needed
if [ ! -f "src/client/css/lumina-theme.css" ]; then
    echo "🎨 Running initial LuminaSync..."
    npm run sync:lumina || true
fi

TARGET_DIR="${1:-./sample-photos}"
echo "🚀 Starting LuminaHDR pointing to: $TARGET_DIR"
node src/server/app.js "$TARGET_DIR" "$@"
