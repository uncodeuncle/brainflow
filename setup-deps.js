// setup-deps.js
// 自动下载并配置依赖二进制文件 (yt-dlp, ffmpeg) - 跨平台支持
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const binDir = path.join(__dirname, 'bin');

if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
}

// 简单的下载包装器
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) {
            console.log(`[Skip] 文件已存在，跳过下载: ${path.basename(dest)}`);
            return resolve();
        }

        console.log(`[Download] 正在下载: ${path.basename(dest)}... (这可能需要几分钟)`);
        const file = fs.createWriteStream(dest);

        // Handle basic redirects
        const request = (currentUrl) => {
            https.get(currentUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    return request(response.headers.location);
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`请求失败，状态码: ${response.statusCode}`));
                    return;
                }

                response.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        // 如果在类 Unix 系统下，赋予执行权限
                        if (process.platform !== 'win32') {
                            fs.chmodSync(dest, 0o755);
                        }
                        console.log(`[Success] 下载完成: ${path.basename(dest)}`);
                        resolve();
                    });
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => { }); // 删除不完整的文件
                reject(err);
            });
        };

        request(url);
    });
}

async function setup() {
    console.log("🚀 开始配置 Brainflow 后台处理环境依赖...");
    const platform = process.platform;

    try {
        // 1. 下载 yt-dlp
        let ytdlpUrl = '';
        let ytdlpDest = '';

        if (platform === 'win32') {
            ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
            ytdlpDest = path.join(binDir, 'yt-dlp.exe');
        } else if (platform === 'darwin') {
            ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
            ytdlpDest = path.join(binDir, 'yt-dlp');
        } else {
            ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
            ytdlpDest = path.join(binDir, 'yt-dlp');
        }
        await downloadFile(ytdlpUrl, ytdlpDest);

        // 2. FFmpeg 提示配置
        console.log("\n==================================");
        if (platform === 'win32') {
            const ffmpegDest = path.join(binDir, 'ffmpeg.exe');
            const ffprobeDest = path.join(binDir, 'ffprobe.exe');
            if (!fs.existsSync(ffmpegDest)) {
                console.warn("⚠️ [警告] 未检测到 ffmpeg.exe");
                console.log("   由于 FFmpeg 体积较大，请手动下载并在 bin 目录下放置 ffmpeg.exe 和 ffprobe.exe。");
                console.log("   下载地址: https://github.com/BtbN/FFmpeg-Builds/releases");
            } else {
                console.log("✅ [检测] ffmpeg.exe 已存在");
            }
        } else {
            console.log("⚠️ [提示] 请确保系统已通过包管理器安装了 FFmpeg。");
            console.log("   - macOS: run `brew install ffmpeg`");
            console.log("   - Ubuntu/Debian: run `sudo apt install ffmpeg`");
        }
        console.log("==================================\n");
        console.log("🎉 环境依赖检查完成！你可以运行 `npm run dev` 和 `npm run worker` 了。");

    } catch (err) {
        console.error("❌ 配置环境失败:", err.message);
        process.exit(1);
    }
}

setup();
