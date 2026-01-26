#!/bin/bash

echo ""
echo "============================================================"
echo ""
echo "  TSight - TypeScript Code Analyzer"
echo ""
echo "  Understand any codebase in 30 seconds."
echo "  No AI. No guessing. Just facts from your code."
echo ""
echo "============================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js is not installed!"
    echo ""
    echo "  TSight requires Node.js 18 or higher."
    echo ""
    echo "  Install from: https://nodejs.org/"
    echo ""
    echo "  Or use your package manager:"
    echo "    Mac:   brew install node"
    echo "    Linux: sudo apt install nodejs npm"
    echo ""
    exit 1
fi

NODE_VERSION=$(node -v)
echo "  [1/4] Node.js detected: $NODE_VERSION"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "  [2/4] Installing dependencies... (first run, may take a minute)"
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "  [ERROR] npm install failed. Check your internet connection."
        exit 1
    fi
    echo "        Done!"
else
    echo "  [2/4] Dependencies installed"
fi
echo ""

# Build if needed
if [ ! -d "packages/core/dist" ]; then
    echo "  [3/4] Building core..."
    npm run build --workspace=@tsight/core
    if [ $? -ne 0 ]; then
        echo "  [ERROR] Build failed."
        exit 1
    fi
    echo "        Done!"
else
    echo "  [3/4] Core ready"
fi

if [ ! -d "packages/api/dist" ]; then
    echo "        Building API..."
    npm run build --workspace=@tsight/api
    if [ $? -ne 0 ]; then
        echo "  [ERROR] Build failed."
        exit 1
    fi
    echo "        Done!"
else
    echo "        API ready"
fi
echo ""

# Start servers
echo "  [4/4] Starting TSight..."
echo ""
echo "  ------------------------------------------------------------"
echo ""
echo "    API server:  http://localhost:3001"
echo "    Web UI:      http://localhost:3000"
echo ""
echo "    Waiting for servers to start..."
echo ""
echo "  ------------------------------------------------------------"
echo ""
echo "    Press Ctrl+C to stop"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "  Stopping servers..."
    kill $API_PID 2>/dev/null
    kill $WEB_PID 2>/dev/null
    exit 0
}

trap cleanup INT

# Start API in background
cd packages/api
npm start 2>/dev/null &
API_PID=$!
cd ../..

# Wait for API to start
sleep 3

# Start Web UI in background
cd packages/web
npm run dev &
WEB_PID=$!
cd ../..

# Wait for Vite to be ready
echo "  Waiting for Vite dev server..."
sleep 5

# Open browser (works on Mac and Linux)
echo "  Opening browser..."
if command -v open &> /dev/null; then
    open http://localhost:3000  # Mac
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000  # Linux
fi

echo ""
echo "  TSight is running!"
echo ""

# Wait for both processes
wait
