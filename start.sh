#!/bin/bash
# Start TSight: installs what's needed, builds, and opens the browser.

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
npm run build -w @tsight/core --silent && npm run build -w @tsight/api --silent || { echo "  Build failed."; exit 1; }

echo "  [3/3] Starting. The UI is at http://localhost:3000 (API on 3001). Press Ctrl+C to stop."
echo ""

cleanup() {
    kill $API_PID $WEB_PID 2>/dev/null
    exit 0
}
trap cleanup INT TERM

(cd packages/api && npm start --silent) &
API_PID=$!
(cd packages/web && npm run dev --silent) &
WEB_PID=$!

sleep 4
if command -v open &> /dev/null; then
    open http://localhost:3000
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 >/dev/null 2>&1
fi

wait
