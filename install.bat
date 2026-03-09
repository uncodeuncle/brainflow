@echo off
chcp 65001 >nul
color 0B
echo ===================================================
echo     欢迎使用 BrainFlow (脑流) 一键无脑安装向导
echo ===================================================
echo.

:: 检查是否安装了 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js！
    echo 脑流依赖 Node.js 运行，请先去官网下载安装: https://nodejs.org/
    echo 安装完毕后，请重新双击本脚本。
    echo.
    pause
    exit /b
)

:: 检查是否安装了 npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 npm！请检查 Node.js 是否正常安装。
    echo.
    pause
    exit /b
)

echo [1/3] 正在为您全自动安装运行依赖 (这可能需要几分钟，请耐心等待代码滚动)...
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [错误] 依赖安装失败！请检查您的网络连接或尝试更换 npm 淘宝镜像源。
    echo.
    pause
    exit /b
)

echo.
echo [2/3] 正在启动配置向导与环境依赖下载...
echo ---------------------------------------------------
call node setup.js
call node setup-deps.js

echo ---------------------------------------------------
color 0A
echo.
echo ===================================================
echo   🎉 恭喜！脑流的所有环境、依赖和密钥都已配置完毕！
echo ===================================================
echo.
echo 下一步：
echo 以后每次想要使用，只需双击运行 【 start.bat 】 即可打开软件！
echo.
pause
