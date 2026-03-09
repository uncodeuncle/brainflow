@echo off
chcp 65001 >nul
color 0A

:: Check if .env exists to extract NEXT_PUBLIC_BASE_PATH
set BASE_PATH=
if exist .env (
    for /f "tokens=1,2 delims==" %%A in (.env) do (
        if "%%A"=="NEXT_PUBLIC_BASE_PATH" (
            set BASE_PATH=%%B
        )
    )
)

echo ===================================================
echo     正在启动 BrainFlow (脑流) 全栈服务...
echo ===================================================
echo.
echo 稍后会自动打开浏览器。如有报错，请确保 Redis 已经运行！
echo 服务启动完成后，您可以访问：
if "%BASE_PATH%"=="" (
    echo http://localhost:3000
) else (
    echo http://localhost:3000%BASE_PATH%
)
echo.

:: 等待几秒钟让服务启动，然后再用资源管理器唤起默认浏览器访问
start /b cmd /c "timeout /t 5 >nul && start http://localhost:3000%BASE_PATH%"

call npm run dev:all

pause
