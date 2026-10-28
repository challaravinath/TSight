#!/bin/bash
# Start TSight: installs what's needed, builds, and opens the browser.
# Usage: ./start.sh [folder to analyze]

TARGET="${1:-}"
if [ -n "$TARGET" ]; then TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "  No such folder: $1"; exit 1; }; fi

cd "$(dirname "$0")" || exit 1

echo ""
echo "  TSight"
echo "  Understand any TypeScript codebase in 30 seconds."
echo "  No AI. No guessing. Just facts from your code."
echo ""

if ! command -v node &> /dev/null; then
    echo "  Node.js is not installed. TSight needs Node.js 20 or newer."
    echo "  Get it from https://nodejs.org/ (or: brew install node)"
    exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "  You have Node.js $(node -v). TSight needs 20 or newer."
    exit 1
fi

echo "  [1/3] Installing dependencies (quick if nothing changed)..."
npm install --no-audit --no-fund --loglevel=error || { echo "  npm install failed. Check your connection."; exit 1; }

echo "  [2/3] Building..."
npm run build --silent > /dev/null || { echo "  Build failed. Run npm run build to see why."; exit 1; }

echo "  [3/3] Starting. Press Ctrl+C to stop."
if [ -n "$TARGET" ]; then
    exec node packages/cli/dist/cli.js "$TARGET"
else
    # No folder given: open the UI and pick one there.
    exec node packages/cli/dist/cli.js --pick
fi
