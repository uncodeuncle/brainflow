#!/bin/bash
echo "==================================================="
echo "    正在启动 BrainFlow (脑流) 全栈服务..."
echo "==================================================="
echo ""

# Check if .env exists to extract NEXT_PUBLIC_BASE_PATH
BASE_PATH=""
if [ -f .env ]; then
    BASE_PATH=$(grep "^NEXT_PUBLIC_BASE_PATH=" .env | cut -d '=' -f2)
fi

echo "服务启动完成后，您可以访问："
echo "http://localhost:3000${BASE_PATH}"
echo ""

# Start the services in the background, open browser, and then bring services to foreground
npm run dev:all &

# Wait a few seconds for server to start, then open browser varying by OS
sleep 5
URL="http://localhost:3000${BASE_PATH}"
if which xdg-open > /dev/null; then
  xdg-open "$URL"
elif which gnome-open > /dev/null; then
  gnome-open "$URL"
elif which open > /dev/null; then
  open "$URL"
fi

wait
