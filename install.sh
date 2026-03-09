#!/bin/bash
echo "==================================================="
echo "    欢迎使用 BrainFlow (脑流) 一键无脑安装向导"
echo "==================================================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null
then
    echo "[错误] 未检测到 Node.js！"
    echo "脑流依赖 Node.js 运行，请先去官网下载安装: https://nodejs.org/"
    echo "或者使用 Homebrew 安装: brew install node"
    echo "安装完毕后，请重新运行本脚本。"
    exit 1
fi

echo "[1/3] 正在为您全自动安装运行依赖 (这可能需要几分钟)..."
npm install
if [ $? -ne 0 ]; then
    echo ""
    echo "[错误] 依赖安装失败！请检查您的网络连接。"
    exit 1
fi

echo ""
echo "[2/3] 正在启动配置向导与环境依赖下载..."
echo "---------------------------------------------------"
node setup.js
node setup-deps.js

echo "---------------------------------------------------"
echo ""
echo "==================================================="
echo "  🎉 恭喜！脑流的所有环境、依赖和密钥都已配置完毕！"
echo "==================================================="
echo ""
echo "下一步："
echo "以后每次想要使用，只需运行 【 ./start.sh 】 即可打开软件！"
echo ""
