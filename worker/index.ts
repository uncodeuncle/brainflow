import { Worker, Job, Queue } from 'bullmq';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import OSS from 'ali-oss';
import dotenv from 'dotenv';
import { fetchBilibiliSubtitle, fetchBilibiliMedia } from './fetchBilibiliSubtitle';
import OpenAI from 'openai';
import { Semaphore } from './Semaphore';

// 全局媒体信号量：所有用户任务共享，控制带宽密集型操作（视频/音频下载、OSS上传）的并发数
const mediaSemaphore = new Semaphore(3);

// Force dotenv to override existing process.env variables cached by the long-running powershell terminal
dotenv.config({ override: true });

// @ts-ignore
import Core from '@alicloud/pop-core';

const execAsync = util.promisify(exec);

/**
 * 创建阿里云 NLS 录音文件识别客户端
 */
function createNlsClient(accessKeyId: string, accessKeySecret: string) {
    return new Core({
        accessKeyId,
        accessKeySecret,
        endpoint: 'https://filetrans.cn-shanghai.aliyuncs.com',
        apiVersion: '2018-08-17'
    });
}

// Token truncation protection (inspired by BibiGPT limitTranscriptByteLength)
function limitTextByteLength(str: string, byteLimit: number): string {
    const byteLen = Buffer.from(str, 'utf-8').length;
    if (byteLen > byteLimit) {
        const ratio = byteLimit / byteLen;
        const truncated = str.substring(0, Math.floor(str.length * ratio));
        console.log(`[Token Guard] Text too long (${byteLen} bytes), truncated to ${byteLimit} bytes (${Math.round(ratio * 100)}%)`);
        return truncated;
    }
    return str;
}

// Configuration
const connection = {
    host: '127.0.0.1',
    port: 6379,
};

// 5. 自动巡检并清理过期临时文件 (清理 1 小时前的文件，防止硬盘爆满)
async function runStorageSanitation() {
    console.log("🧹 启动存储空间自动巡检...");
    const publicDir = path.join(process.cwd(), 'public', 'downloads');
    const hiddenDir = path.join(process.cwd(), 'downloads');
    const MAX_AGE_MS = 1 * 60 * 60 * 1000; // 1 小时

    const cleanupDir = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        let count = 0;
        files.forEach(file => {
            const filePath = path.join(dir, file);
            try {
                const stats = fs.statSync(filePath);
                if (Date.now() - stats.mtimeMs > MAX_AGE_MS) {
                    if (stats.isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(filePath);
                    }
                    count++;
                }
            } catch (e) {
                // ignore
            }
        });
        if (count > 0) console.log(`[Sanitation] 已从 ${path.basename(dir)} 清理 ${count} 个过期文件`);
    };

    cleanupDir(publicDir);
    cleanupDir(hiddenDir);
}

// 每次重启 Worker 时执行一次清理，并设置每小时自动巡检一次
(async () => {
    try {
        console.log("🧹 正在清理离线期间残留的历史任务积压...");
        const initQueue = new Queue('bili-extract', { connection });
        await initQueue.obliterate({ force: true });
        console.log("✅ 历史任务队列已彻底清空，资金安全！");

        await runStorageSanitation();
        setInterval(runStorageSanitation, 60 * 60 * 1000); // 每小时巡检一次
    } catch (e) {
        // ignore
    }
})();

console.log("启动 BiliBrain 后台任务队列处理模块 (Worker)...等待任务接入中...");

const worker = new Worker('bili-extract', async (job: Job) => {
    console.log(`\n===========================================`)
    console.log(`[JOB 启动] 收到新任务 ID: ${job.id}`);
    console.log(`待处理的 P 数量: ${job.data.items?.length}, 需要输出格式: markdown:${job.data.formats.markdown} marp:${job.data.formats.marp} mermaid:${job.data.formats.mermaid}`);

    await job.updateProgress({ step: 'init', message: '任务已进入队列', percent: 5 });

    const items = job.data.items || [];
    const results: any[] = [];
    const totalItems = items.length;
    const itemProgressWeight = 85 / (totalItems || 1);

    // 进度条水位线：只升不降，防止并发更新导致进度条回退
    let progressHWM = 5;
    const safeUpdateProgress = async (data: any) => {
        if (data.percent != null) {
            data.percent = Math.max(data.percent, progressHWM);
            progressHWM = data.percent;
        } else {
            // 如果没传 percent（如 video_done），使用当前水位线
            data.percent = progressHWM;
        }
        await job.updateProgress(data);
    };

    // Reuse credentials for Tingwu
    const cleanKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.replace(/['"]/g, '').trim() || '';
    const cleanKeySecret = (process.env.ALIYUN_ACCESS_KEY_SECRET as string)?.replace(/['"]/g, '').trim() || '';
    const cleanAppKey = process.env.TINGWU_APP_KEY?.replace(/['"]/g, '').trim() || '';

    const concurrencyLimit = 5; // 主流水线并发：文字 API 很轻量，放开跑
    const textSemaphore = new Semaphore(concurrencyLimit); // 滑动窗口：一个P完成立刻补下一个
    const videoDownloadPromises: Promise<void>[] = []; // Collect all video downloads for final await
    await Promise.all(items.map(async (item: any, i: number) => {
        await textSemaphore.acquire();
        try {
            const baseProgress = 5 + (i * itemProgressWeight);
            const stepProgress = itemProgressWeight / 4;

            const safeTitle = item.title.replace(/[\\/:*?"<>|]/g, '_');

            console.log(`\n---> 开始处理 P${item.index} : ${item.title}`);
            await safeUpdateProgress({ step: 'download', p: item.index, title: item.title, message: '提取结构化文本中...', percent: Math.round(baseProgress + stepProgress * 1), partialResults: results });


            try {
                // Execution Phase
                // Cross-platform path handling
                const isWin = process.platform === 'win32';
                const ytdlpPath = isWin
                    ? path.join(process.cwd(), 'bin', 'yt-dlp.exe')
                    : 'yt-dlp'; // Use system-installed version on Linux

                const publicDir = path.join(process.cwd(), 'public', 'downloads');
                const hiddenDir = path.join(process.cwd(), 'downloads');

                if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
                if (!fs.existsSync(hiddenDir)) fs.mkdirSync(hiddenDir, { recursive: true });

                // 【核心修复】：将用户的 SESSDATA 写成 Netscape Cookie 文件，传给 yt-dlp
                // 这样服务器上的 yt-dlp 也能像本地浏览器一样通过源平台身份验证，绕过 412
                const rawSessdataForCookie = job.data.sessdata || process.env.BILIBILI_SESSION_TOKEN?.replace(/['"]/g, '').trim();
                let cookieArg = '';
                if (rawSessdataForCookie) {
                    const cookieFilePath = path.join(hiddenDir, `cookies_${item.index}.txt`);
                    const decodedSessdata = decodeURIComponent(rawSessdataForCookie);
                    const cookieContent = `# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\t${decodedSessdata}\n`;
                    fs.writeFileSync(cookieFilePath, cookieContent);
                    cookieArg = `--cookies "${cookieFilePath}"`;
                    console.log(`[P${item.index}] 🍪 已生成 Cookie 文件用于 yt-dlp 身份验证`);
                }
                const robustNetworkArgs = `--retries 30 --fragment-retries 30 --retry-sleep 3 --continue --sleep-requests 1 --sleep-interval 2 --max-sleep-interval 5 ${cookieArg} --extractor-args "bilibili:player_client=h5" --add-header "Referer: https://www.bilibili.com/" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"`;

                const rawUrl = job.data.url.replace(/^(?!https?:\/\/)/i, 'https://');
                const parsedUrl = new URL(rawUrl);
                // Keep query params for non-bilibili sites (like Xiaohongshu) as they contain required security tokens (xsec_token)
                const isBilibili = parsedUrl.hostname.includes('bilibili.com') || parsedUrl.hostname.includes('b23.tv');
                const cleanUrl = isBilibili ? `${parsedUrl.origin}${parsedUrl.pathname}` : rawUrl;

                // Only add local bin to PATH on Windows
                const env = { ...process.env };
                if (isWin) {
                    const ffmpegPath = path.join(process.cwd(), 'bin');
                    env.PATH = `${ffmpegPath};${process.env.PATH}`;
                }
                const expectedBaseName = `${safeTitle}_P${item.index}`;
                const isVideoIncluded = job.data.formats?.downloadVideo;

                const resultObj: any = {
                    index: item.index,
                    title: item.title,
                    status: 'success',
                };

                // ======== 智能字幕获取 (字幕优先，音频降级) ========
                let fullText = '';
                let transcriptionMethod = '';

                // 【核心修复】：解析 item.id 中的 BV号 和 分P号
                // yt-dlp 对多P视频可能返回 id=BV1NCgVzoEG9_p2 格式，需要拆分
                let realBvid = '';
                let realPage = 1; // 视频内部的分P号 (1-based)
                if (item.id && item.id.startsWith('BV')) {
                    const pageMatch = item.id.match(/^(BV[a-zA-Z0-9]+?)(?:_p(\d+))?$/);
                    if (pageMatch) {
                        realBvid = pageMatch[1];
                        realPage = pageMatch[2] ? parseInt(pageMatch[2]) : 1;
                    } else {
                        realBvid = item.id;
                    }
                }

                // 根据解析出的信息配置 yt-dlp 目标
                let ytdlpTargetUrl = cleanUrl;
                let ytdlpTargetOptions = `--playlist-items ${item.index}`;

                if (item.url) {
                    ytdlpTargetUrl = item.url;
                    ytdlpTargetOptions = `--playlist-items 1`;
                } else if (realBvid) {
                    const parentBvid = cleanUrl.match(/BV[a-zA-Z0-9]+/)?.[0];
                    if (realBvid !== parentBvid) {
                        ytdlpTargetUrl = `https://www.bilibili.com/video/${realBvid}/`;
                        // 如果是多P视频的某一P，用 --playlist-items 定位
                        ytdlpTargetOptions = `--playlist-items ${realPage}`;
                    }
                }

                console.log(`[DEBUG-YTDLP] P${item.index} 准备兜底提取`);
                console.log(`[DEBUG-YTDLP] 传入参数: item.url=${item.url}, item.id=${item.id}, realBvid=${realBvid}, realPage=${realPage}, cleanUrl=${cleanUrl}`);
                console.log(`[DEBUG-YTDLP] 最终决定 yt-dlp 目标 URL: ${ytdlpTargetUrl}`);
                console.log(`[DEBUG-YTDLP] 最终决定 yt-dlp 列表参数: ${ytdlpTargetOptions}`);

                // --------------- 优先级一：源平台 API 字幕直取 (0成本, 秒级) ---------------
                console.log(`[P${item.index}] 🚀 尝试源平台 API 字幕直取...`);
                await safeUpdateProgress({ step: 'transcribe', p: item.index, message: '正在提取核心信息...', percent: Math.round(baseProgress + stepProgress * 1), partialResults: results });

                // SESSDATA: 1) 用户扫码存 localStorage → 前端传入 2) .env 环境变量
                const rawSessdata = job.data.sessdata || process.env.BILIBILI_SESSION_TOKEN?.replace(/['"]/g, '').trim();
                // 必须进行 URI 编码，防止用户传入的 SESSDATA 带有分号、逗号、星号等导致解析 Cookie 失败并返回 -412
                const sessdata = rawSessdata ? encodeURIComponent(decodeURIComponent(rawSessdata)) : undefined;

                if (!sessdata) {
                    console.log(`[P${item.index}] ⚠️ 未提供 SESSDATA，API 可能无法返回完整字幕数据`);
                } else {
                    console.log(`[P${item.index}] 🔑 SESSDATA 已就绪 (编码后长: ${sessdata.length})`);
                }
                // 尝试从 yt-dlp 抓取的单视频 ID 中提前获取 BV 号 (处理短链接或播放列表的场景)
                // 使用解析后的真实 BV 号和真实分P号（非合集序号）调用字幕 API
                const identifierForSubtitle = realBvid || rawUrl;
                const pageForSubtitle = realBvid ? realPage : item.index;
                console.log(`[P${item.index}] 字幕查询: bvid=${identifierForSubtitle}, page=${pageForSubtitle}`);
                const subtitleResult = await fetchBilibiliSubtitle(identifierForSubtitle, pageForSubtitle, sessdata);

                if (subtitleResult.success && subtitleResult.text.length > 50) {
                    fullText = subtitleResult.text;
                    transcriptionMethod = 'bilibili_api';
                    console.log(`[P${item.index}] ✅ 字幕直取成功！(${fullText.length} 字符, 方法: ${transcriptionMethod})`);
                } else {
                    // --------------- 优先级二：yt-dlp --write-sub 提取字幕文件 ---------------
                    console.log(`[P${item.index}] ⚠️ API 字幕不可用 (${subtitleResult.error}), 尝试 yt-dlp 字幕提取...`);
                    await safeUpdateProgress({ step: 'transcribe', p: item.index, message: '正在提取内容...', percent: Math.round(baseProgress + stepProgress * 1.5), partialResults: results });

                    try {
                        const subDir = path.join(hiddenDir, 'subs');
                        if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

                        const subOutputTemplate = path.join(subDir, `${expectedBaseName}.%(ext)s`);
                        const subCommand = `"${ytdlpPath}" ${robustNetworkArgs} --write-sub --write-auto-sub --sub-lang "zh-Hans,zh-CN,zh,en" --skip-download --convert-subs srt -o "${subOutputTemplate}" ${ytdlpTargetOptions} "${ytdlpTargetUrl}"`;
                        console.log(`[DEBUG-YTDLP] 执行字幕下载指令: ${subCommand}`);
                        await execAsync(subCommand, { env });

                        // 查找下载下来的字幕文件
                        const subFiles = fs.readdirSync(subDir).filter(f => f.startsWith(expectedBaseName) && (f.endsWith('.srt') || f.endsWith('.vtt')));
                        if (subFiles.length > 0) {
                            const subContent = fs.readFileSync(path.join(subDir, subFiles[0]), 'utf-8');
                            // 清洗 SRT 格式：去掉序号、时间戳行，只留文字
                            fullText = subContent
                                .replace(/^\d+\s*$/gm, '')              // 序号行
                                .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/g, '') // 时间戳行
                                .replace(/<[^>]+>/g, '')                 // HTML 标签
                                .replace(/\n{2,}/g, ' ')                 // 多余换行
                                .trim();
                            transcriptionMethod = 'yt-dlp_subtitle';
                            console.log(`[P${item.index}] ✅ yt-dlp 字幕提取成功！(${fullText.length} 字符)`);
                        }
                    } catch (subErr: any) {
                        console.warn(`[P${item.index}] yt-dlp 字幕提取失败:`, subErr.message);
                    }
                }

                // --------------- 优先级三：兜底 - 下载音频 + 阿里云 NLS 转录 (有成本) ---------------
                if (!fullText || fullText.length < 50) {
                    console.log(`[P${item.index}] ⚠️ 字幕均不可用，降级到阿里云 NLS 语音转文字 (会消耗配额)...`);
                    await safeUpdateProgress({ step: 'download', p: item.index, message: '启动语义识别...', percent: Math.round(baseProgress + stepProgress * 2), partialResults: results });

                    // Audio extraction via 原生 API (bypasses yt-dlp 412)
                    // 带宽密集段：下载 + FFmpeg + OSS 上传 → 完成后释放 media slot
                    let audioResolvedFileName = `${expectedBaseName}_16k.mp3`;
                    let audioActualFilePath = path.join(hiddenDir, audioResolvedFileName);
                    let rawAudioFilePath = '';

                    await mediaSemaphore.acquire(); // 获取媒体 slot
                    try {
                        if (realBvid) {
                            console.log(`[P${item.index}] 🔊 通过原生 API 下载音频用于语音转文字 (B站高速通道)...`);
                            const audioTargetUrl = `https://www.bilibili.com/video/${realBvid}/`;
                            const audioMediaResult = await fetchBilibiliMedia(
                                audioTargetUrl, realPage, sessdata ? decodeURIComponent(sessdata) : undefined,
                                hiddenDir, expectedBaseName,
                                { audio: true, video: false }
                            );

                            if (!audioMediaResult.success || !audioMediaResult.audioPath) {
                                throw new Error(`原生 API 音频下载失败: ${audioMediaResult.error || '未知错误'}`);
                            }
                            rawAudioFilePath = audioMediaResult.audioPath;
                        } else {
                            console.log(`[P${item.index}] 🔊 检测到非标准B站链接(如小红书/油管)，使用通用流媒体引擎 (yt-dlp) 提取音频...`);
                            rawAudioFilePath = path.join(hiddenDir, `${expectedBaseName}_ytdl.m4a`);
                            // We use a robust User-Agent and let yt-dlp auto-select the best format to avoid 'No video formats found' on strict platforms like Xiaohongshu
                            const genericUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
                            const ytdlpAudioCmd = `"${ytdlpPath}" --extract-audio --audio-format m4a --output "${rawAudioFilePath}" --no-check-certificates --user-agent "${genericUA}" "${cleanUrl}"`;
                            await execAsync(ytdlpAudioCmd, { env });
                        }

                        console.log(`执行 FFmpeg 音频降频 (强制 16000Hz 单声道 MP3)...`);
                        const ffmpegCommand = `ffmpeg -y -i "${rawAudioFilePath}" -ar 16000 -ac 1 -ab 64k "${audioActualFilePath}"`;
                        await execAsync(ffmpegCommand, { env });

                        // OSS Upload
                        console.log('将音频上传至阿里云 OSS ...');
                        await safeUpdateProgress({ step: 'upload', p: item.index, message: '上传中...', percent: Math.round(baseProgress + stepProgress * 2.5), partialResults: results });

                        const cleanRegion = (process.env.ALIYUN_OSS_REGION || '').replace(/['"]/g, '').replace('.aliyuncs.com', '').trim();
                        const cleanBucket = (process.env.ALIYUN_OSS_BUCKET || '').replace(/['"]/g, '').trim().replace(/[^a-z0-9-]/g, '');
                        const client = new OSS({ region: cleanRegion, accessKeyId: cleanKeyId, accessKeySecret: cleanKeySecret, bucket: cleanBucket });
                        const ossObjectName = `bilibrain-audio/${Date.now()}_${audioResolvedFileName}`;
                        await client.put(ossObjectName, audioActualFilePath);
                        const signedUrl = client.signatureUrl(ossObjectName, { expires: 14400 });
                        resultObj.ossAudioUrl = signedUrl;
                    } finally {
                        mediaSemaphore.release(); // ⚠️ 上传完就释放 slot，NLS 轮询不占带宽
                    }

                    // 以下是纯 API 轮询，不占 media slot

                    // NLS Transcription
                    console.log('正在提交阿里云 NLS 录音文件识别任务...');
                    await safeUpdateProgress({ step: 'transcribe', p: item.index, message: '正在转录音频...', percent: Math.round(baseProgress + stepProgress * 3), partialResults: results });

                    const nlsClient = createNlsClient(cleanKeyId, cleanKeySecret);
                    const taskParams = { appkey: cleanAppKey, file_link: resultObj.ossAudioUrl, version: '4.0', enable_words: false };
                    const submitResponse: any = await nlsClient.request('SubmitTask', { Task: JSON.stringify(taskParams) }, { method: 'POST' });
                    const taskId = submitResponse.TaskId;
                    if (!taskId) {
                        // Graceful degradation: detect quota exhaustion instead of crashing
                        const statusText = submitResponse.StatusText || '';
                        if (statusText.includes('QUOTA_EXCEED') || submitResponse.StatusCode === 41050001) {
                            console.error(`[P${item.index}] ❌ 阿里云 NLS 配额已耗尽: ${statusText}`);
                            fullText = `[此视频无法提取文字] 原因：该视频没有平台字幕，需要语音转文字服务，但阿里云 NLS 配额已用完。请登录阿里云控制台充值语音识别配额，或选择有字幕的视频进行分析。`;
                            transcriptionMethod = 'quota_exceeded';
                        } else {
                            throw new Error(`NLS 任务提交失败: ${JSON.stringify(submitResponse)}`);
                        }
                    }

                    if (taskId) {
                        let transcriptionResult: any = null;
                        let pollCount = 0;
                        while (pollCount < 60) {
                            await new Promise(r => setTimeout(r, 10000));
                            pollCount++;
                            const taskInfo: any = await nlsClient.request('GetTaskResult', { TaskId: taskId }, { method: 'GET' });
                            if (taskInfo.StatusText === 'SUCCESS') { transcriptionResult = taskInfo.Result; break; }
                            else if (taskInfo.StatusText === 'SUCCESS_WITH_NO_VALID_FRAGMENT') {
                                console.warn(`[P${item.index}] ⚠️ NLS 返回 SUCCESS_WITH_NO_VALID_FRAGMENT（音频无有效语音，可能是纯音乐/BGM）`);
                                fullText = `[此视频无有效语音] 音频中未检测到可识别的语音片段（可能是纯音乐/BGM），无法生成文字转录。`;
                                transcriptionMethod = 'nls_no_speech';
                                break;
                            }
                            else if (taskInfo.StatusText === 'FAILED') throw new Error(`NLS 转录失败: ${JSON.stringify(taskInfo)}`);
                            await safeUpdateProgress({ step: 'transcribe', p: item.index, message: `转录中: ${taskInfo.StatusText}...`, percent: Math.round(baseProgress + stepProgress * 3), partialResults: results });
                        }
                        if (!transcriptionResult && transcriptionMethod !== 'nls_no_speech') throw new Error("NLS 转录超时");
                        if (transcriptionResult) {
                            fullText = transcriptionResult.Sentences?.map((s: any) => s.Text).join(' ') || "转录结果为空";
                            transcriptionMethod = 'aliyun_nls';
                        }
                    }
                }

                resultObj.transcription = fullText;
                resultObj.transcriptionMethod = transcriptionMethod;
                console.log(`[P${item.index}] 📝 文字获取完成 (方法: ${transcriptionMethod}, ${fullText.length} 字符)`);

                // Video extraction (fire-and-forget, runs fully in background)
                if (isVideoIncluded) {
                    resultObj.isVideoDownloading = true; // Let the frontend know a video is coming
                    const vp = (async () => {
                        await mediaSemaphore.acquire(); // 获取媒体下载 slot
                        try {
                            if (realBvid) {
                                console.log(`[P${item.index}] 🎬 通过原生 API 下载视频 (B站高速通道)...`);
                                const videoTargetUrl = `https://www.bilibili.com/video/${realBvid}/`;
                                const mediaResult = await fetchBilibiliMedia(
                                    videoTargetUrl, realPage, sessdata ? decodeURIComponent(sessdata) : undefined,
                                    hiddenDir, expectedBaseName,
                                    { audio: true, video: true }
                                );
                                if (mediaResult.success && mediaResult.videoPath && mediaResult.audioPath) {
                                    const mergedPath = path.join(publicDir, `${expectedBaseName}.mp4`);
                                    const mergeCmd = `ffmpeg -y -i "${mediaResult.videoPath}" -i "${mediaResult.audioPath}" -c:v copy -c:a aac -strict experimental "${mergedPath}"`;
                                    console.log(`[P${item.index}] 🔀 FFmpeg 合并音视频...`);
                                    await execAsync(mergeCmd, { env });
                                    resultObj.videoUrl = `/tools/brainflow/downloads/${expectedBaseName}.mp4`;
                                    resultObj.localPath = mergedPath;
                                    console.log(`[P${item.index}] ✅ 视频下载+合并完成！`);
                                } else if (mediaResult.error) {
                                    console.warn(`[P${item.index}] ⚠️ 原生 API 视频下载失败: ${mediaResult.error}`);
                                }
                            } else {
                                console.log(`[P${item.index}] 🎬 检测到非标准B站链接，使用通用流媒体引擎 (yt-dlp) 提取视频...`);
                                const mergedPath = path.join(publicDir, `${expectedBaseName}.mp4`);
                                const genericUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
                                // yt-dlp will automatically download best video+audio and merge them if ffmpeg is available
                                const ytdlpVideoCmd = `"${ytdlpPath}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 --output "${mergedPath}" --no-check-certificates --user-agent "${genericUA}" "${cleanUrl}"`;
                                await execAsync(ytdlpVideoCmd, { env });
                                resultObj.videoUrl = `/tools/brainflow/downloads/${expectedBaseName}.mp4`;
                                resultObj.localPath = mergedPath;
                                console.log(`[P${item.index}] ✅ 通用视频下载+合并完成！`);
                            }
                        } catch (e: any) {
                            console.warn(`[P${item.index}] ❌ 视频下载异常: ${e.message?.slice(0, 100)}`);
                        } finally {
                            mediaSemaphore.release(); // ⚠️ 必须释放 slot，无论成功失败
                            // Turn off loading flag and optionally tell frontend to render the download button
                            resultObj.isVideoDownloading = false;
                            await safeUpdateProgress({
                                step: 'video_done',
                                p: item.index,
                                message: `P${item.index} 视频后处理更新`,
                                partialResults: results
                            }).catch(e => console.error("进度更新补丁失败", e));
                        }
                    })();
                    videoDownloadPromises.push(vp);
                }

                // Phase 6: DeepSeek API Integration
                // 字幕极短时跳过 AI 分析，避免 DeepSeek 返回空 chapters
                if (fullText.length < 100 || fullText.startsWith('[此视频无')) {
                    console.warn(`[P${item.index}] 字幕过短或无效 (${fullText.length}字), 跳过 AI 分析`);
                    resultObj.chapters = [{
                        id: 'chapter_short',
                        title: item.title,
                        nodes: [{
                            id: 'card_short_01',
                            title: '内容摘要',
                            type: 'concept',
                            content: fullText,
                            detailedPoints: [],
                            relations: []
                        }]
                    }];
                    resultObj.terms = [];
                    resultObj.summary = JSON.stringify({ chapters: resultObj.chapters, terms: [] });
                    resultObj.transcriptionMethod = resultObj.transcriptionMethod || transcriptionMethod;
                    console.log(`[P${item.index}] ✅ 短内容已生成占位卡片`);
                } else {
                    console.log('调用 DeepSeek 提取高颗粒度知识模块...');
                    await safeUpdateProgress({ step: 'ai_brain', p: item.index, message: '正在进行深度知识萃取...', percent: Math.round(baseProgress + stepProgress * 4), partialResults: results });

                    // Pass full text to DeepSeek (no truncation)
                    const safeFullText = fullText;

                    try {
                        const deepseekKey = (process.env.DEEPSEEK_API_KEY as string)?.replace(/['"]/g, '').trim();

                        if (!deepseekKey) {
                            throw new Error("Missing DEEPSEEK_API_KEY in environment variables. 请在 .env 文件中添加 DEEPSEEK_API_KEY");
                        }

                        const openai = new OpenAI({
                            baseURL: 'https://api.deepseek.com',
                            apiKey: deepseekKey
                        });

                        const systemPrompt = `你是一名极度理性的专属知识库架构师。
核心任务是将视频文稿萃取为原子化、**树状层级**的知识卡片流 (Card Flow)。

【格式要求】
必须严格输出以下格式的纯 JSON 数据，禁止任何 Markdown 代码块包装（不要 \`\`\`json 的 markdown 容器），直接以 { 开始，以 } 结束。

【JSON 结构定义 (树状关联)】
{
  "chapters": [
    {
      "id": "chapter_01",
      "title": "大项一：画面基础参数设定", // 高度归纳的章节名称，替代原来碎片的标题
      "nodes": [
        {
          "id": "card_01",
          "title": "分辨率设置细节",
          "type": "concept" | "argument" | "data" | "conclusion" | "action", // 卡片类型
          "content": "关于该步骤的整体概述与核心原理", // 不要把具体的琐碎步骤塞在这，写总结性话语
          "timestamp": "01:20-02:05", // 整体时间戳
          "detailedPoints": [ // 这里是重点！细碎的操作、参数组合、具体反面案例全部作为独立的 point 子级存放
            { "point": "16:9 适合横屏展示，不要搞混", "timestamp": "01:25" },
            { "point": "在设置面板的右上角点击高级选项可解锁 4K", "timestamp": "01:40" }
          ],
          "relations": [
            {
              "targetId": "card_02", // 关系链目标
              "type": "supports" | "leads_to" | "counter_argument" | "example_of", 
              "label": "推导出" | "反驳" | "补充案例" | "理论依据"
            }
          ]
        }
      ]
    }
  ],
  "terms": [
    {
      "term": "专业词汇A", // 具体提取数量请根据视频内容的专业深度和信息密度自主判断，不设硬性上下限，宁缺毋滥，只摘取真正的难点/黑话
      "brief": "一句话大白话通俗解释"
    }
  ]
}

【内容提炼原则 (极其重要)】
1. **同类项合并 (树状归纳)**：同类细分操作必须归纳进同一个节点的 detailedPoints 数组里，绝对不要像做字幕一样每句话切一个卡片！
2. **章节控制**：10 分钟视频产出 2-5 个 chapters，每个 chapter 下 1-4 个 nodes。
3. **剥离废话**：只保留高信息密度干货，摒弃口语转折词。
4. 纯净度：确保 JSON 结构合法。

【Few-shot 正确示例】
输入: 关于出图参数的视频
输出: {"chapters":[{"id":"chapter_01","title":"出图基础参数配置","nodes":[{"id":"card_01","title":"采样器与步数搭配","type":"concept","content":"采样器和步数决定出图质量与速度的平衡。","timestamp":"00:45-02:30","detailedPoints":[{"point":"Euler a 适合快速出草图 20步足够","timestamp":"00:50"},{"point":"DPM++ 2M Karras 适合精修 30-40步","timestamp":"01:15"}],"relations":[{"targetId":"card_02","type":"leads_to","label":"配合使用"}]}]}],"terms":[{"term":"CFG Scale","brief":"控制AI对提示词服从程度的参数"}]}

【错误示例 - 绝对禁止】
chapters: [{ nodes: [{ title: "打开设置" }, { title: "选择16:9" }, { title: "点击确认" }] }]`;

                        const completion = await openai.chat.completions.create({
                            messages: [
                                { role: "system", content: systemPrompt },
                                { role: "user", content: `【视频标题上下文】：${item.title}\n\n请严格基于以下转录文稿，进行极度克制、具有归纳性的结构萃取（原封不动抄写关键参数，但摒弃无用转折口语），并只输出合法的 JSON 格式：\n\n${fullText}` }
                            ],
                            model: "deepseek-chat",
                            response_format: { type: "json_object" }
                        });

                        const rawContent = completion.choices[0].message.content || '{}';
                        resultObj.summary = rawContent;
                        try {
                            const parsed = JSON.parse(rawContent);
                            resultObj.chapters = parsed.chapters || [];
                            resultObj.terms = parsed.terms || [];
                        } catch (e) {
                            console.warn(`P${item.index} JSON 解析失败，保留 raw summary作为 fallback`);
                        }
                        console.log(`P${item.index} DeepSeek 回包解析成功！`);
                    } catch (aiError: any) {
                        console.error('DeepSeek AI 提取失败:', aiError);
                        resultObj.summary = `AI 分析失败，但已获取到转录文本。\n错误: ${aiError.message}`;
                    }
                } // ← 关闭 short-text else 分支


                results.push(resultObj);

                // 【关键修改：提前将局部结果通过 progress 传递给前台】
                results.sort((a, b) => a.index - b.index); // 确保并发下局部结果依然有序
                await safeUpdateProgress({
                    step: 'ai_brain_done',
                    p: item.index,
                    message: `P${item.index} 知识萃取完成`,
                    percent: Math.round(baseProgress + stepProgress * 4),
                    partialResults: results // 将目前所有已解析成功的 P 传给前台以便提前渲染
                });

            } catch (err: any) {
                console.error(`P${item.index} 处理失败:`, err);
                results.push({
                    index: item.index,
                    title: item.title,
                    status: 'error',
                    error: err.message,
                    chapters: [],
                    terms: [],
                    summary: JSON.stringify({ error: err.message })
                });
                // ❗ 必须推送进度，否则前端永远收不到这个 P 的结果
                await safeUpdateProgress({
                    step: 'error', p: item.index,
                    message: `P${item.index} 处理失败: ${err.message?.slice(0, 80)}`,
                    partialResults: results
                }).catch(() => { });
            }
        } finally {
            textSemaphore.release();
        }
    }));

    results.sort((a, b) => a.index - b.index); // Final sort to guarantee correct order

    // 【多步 Map-Reduce 流水线】如果这是合集，分步生成全局沙盘结构
    const successResults = results.filter(r => r.status === 'success' && r.chapters && r.chapters.length > 0);
    console.log(`[Map-Reduce 前置检查] 共 ${results.length} 个结果, 成功 ${successResults.length} 个, 失败 ${results.length - successResults.length} 个`);
    if (successResults.length > 1) {
        try {
            console.log('---> 开始多步 Map-Reduce 跨集融合流水线...');
            const deepseekKey = (process.env.DEEPSEEK_API_KEY as string)?.replace(/['"]/g, '').trim();
            const openai = new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: deepseekKey });

            // ========== 第一步：轻量调用生成 title + overview ==========
            await safeUpdateProgress({ step: 'map_reduce', message: '正在生成合集概览...', percent: 88, partialResults: results });
            console.log('[Map-Reduce 1/4] 生成合集 title + overview...');

            // 构建精华骨架：只取成功的分P
            const skeletonInput = successResults.map(r => {
                const chapterTitles = (r.chapters || []).map((ch: any) => ch.title).join(' / ');
                const termNames = (r.terms || []).map((t: any) => t.term).join('、');
                return `[第${r.index}集 ${r.title}]\n章节：${chapterTitles || '无'}\n术语：${termNames || '无'}`;
            }).join('\n\n');

            const titleOverviewCompletion = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system", content: `你是一名内容概括专家。请根据用户提供的系列视频骨架信息，输出纯 JSON（禁止 markdown），格式如下：
{
  "title": "用一句话概括这个合集的核心主题（精炼、有概括力，不超过20字）",
  "overview": "用2-3句话简要概述整个合集的核心内容和精华，让读者快速了解这个系列讲了什么、主旨是什么。控制在80字以内。"
}` },
                    { role: "user", content: `以下是一个包含 ${successResults.length} 集的系列视频的结构概览：\n\n${skeletonInput}` }
                ],
                model: "deepseek-chat",
                response_format: { type: "json_object" },
                temperature: 0.3,
                max_tokens: 512
            });

            let globalTitle = '全集总览';
            let globalOverview = '';
            try {
                const toResult = JSON.parse(titleOverviewCompletion.choices[0].message?.content || '{}');
                globalTitle = toResult.title || globalTitle;
                globalOverview = toResult.overview || globalOverview;
                console.log(`[Map-Reduce 1/4] ✅ title="${globalTitle}", overview="${globalOverview}"`);
            } catch (e) {
                console.warn('[Map-Reduce 1/4] ⚠️ title/overview 解析失败，使用默认值');
            }

            // ========== 第 2a 步：结构规划 —— 识别跨集宏观主题 ==========
            await safeUpdateProgress({ step: 'map_reduce', message: '正在规划跨集知识结构...', percent: 90, partialResults: results });
            console.log('[Map-Reduce 2/4] 结构规划：识别跨集主题骨架...');

            const allSummaries = successResults.map(r => `[第${r.index}集 ${r.title}]\n` + JSON.stringify(r.chapters)).join('\n\n');
            const safeAllSummaries = limitTextByteLength(allSummaries, 60000);

            const planningCompletion = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system", content: `你是一名宏观知识架构师。用户提供了一个多集系列的所有分集结构化数据。
你的任务是：分析所有集的内容，识别出贯穿全集的 3-6 个宏观知识主题，并指出每个主题的内容主要来自哪几集。

【输出格式】纯 JSON，禁止 markdown：
{
  "themes": [
    {
      "id": "theme_01",
      "title": "宏观主题名称（高度归纳）",
      "description": "一句话说明这个主题涵盖什么",
      "sources": [1, 3, 5]
    }
  ]
}

【铁律】
1. 每个 P（集）必须至少被一个主题覆盖，不允许遗漏任何一集。
2. 同一个 P 可以出现在多个主题中（如果它的内容横跨多个主题）。
3. 主题划分要有逻辑层次感，不要只是把原来的集数重新编号。要真正做到"打碎重组"。
4. 只输出规划骨架，不要输出任何详细内容。` },
                    { role: "user", content: `以下是 ${successResults.length} 集视频的完整结构化数据，请分析并输出跨集主题规划：\n\n${safeAllSummaries}` }
                ],
                model: "deepseek-chat",
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 2048
            });

            let themes: any[] = [];
            try {
                const planResult = JSON.parse(planningCompletion.choices[0].message?.content || '{}');
                themes = planResult.themes || [];
                console.log(`[Map-Reduce 2/4] ✅ 识别出 ${themes.length} 个跨集主题：${themes.map((t: any) => t.title).join(' | ')}`);
            } catch (e) {
                console.error('[Map-Reduce 2/4] ❌ 主题规划解析失败:', e);
                throw new Error('跨集主题规划 JSON 解析失败');
            }

            // 兜底校验：确保每个P至少被一个主题覆盖
            const allPIndexes = successResults.map(r => r.index);
            const coveredIndexes = new Set(themes.flatMap((t: any) => t.sources || []));
            const uncovered = allPIndexes.filter(idx => !coveredIndexes.has(idx));
            if (uncovered.length > 0) {
                console.warn(`[Map-Reduce 2/4] ⚠️ 以下 P 未被任何主题覆盖，自动追加到最后一个主题: ${uncovered.join(', ')}`);
                if (themes.length > 0) {
                    themes[themes.length - 1].sources = [...(themes[themes.length - 1].sources || []), ...uncovered];
                }
            }

            // ========== 第 2b 步：全并发主题深度融合 ==========
            console.log(`[Map-Reduce 3/4] 开始并发融合 ${themes.length} 个主题...`);
            await safeUpdateProgress({ step: 'map_reduce', message: `正在并发融合 ${themes.length} 个主题...`, percent: 91, partialResults: results });

            const globalChapters: any[] = new Array(themes.length);

            await Promise.all(themes.map(async (theme: any, ti: number) => {
                console.log(`[Map-Reduce 3/4] 融合主题 ${ti + 1}/${themes.length}：「${theme.title}」(来源: P${(theme.sources || []).join(', P')})`);

                // 只传该主题关联的 P 的 chapters 数据
                const sourceIndexes: number[] = theme.sources || [];
                const relevantData = successResults
                    .filter(r => sourceIndexes.includes(r.index))
                    .map(r => `[第${r.index}集 ${r.title}]\n${JSON.stringify(r.chapters)}`)
                    .join('\n\n');

                const themeCompletion = await openai.chat.completions.create({
                    messages: [
                        {
                            role: "system", content: `你是一名深度知识融合专家。用户给你了多集视频中与「${theme.title}」主题相关的结构化数据。
你的任务是：将这些来自不同集的内容融合重组成一个完整、有深度的知识章节。

【输出格式】纯 JSON，禁止 markdown：
{
  "id": "${theme.id}",
  "title": "${theme.title}",
  "nodes": [
    {
      "id": "node_xx",
      "title": "融合后的知识节点标题",
      "type": "concept",
      "content": "该节点的核心内容概述，保留技术深度",
      "timestamp": "来自 P1, P3",
      "detailedPoints": [
        { "point": "具体的技术细节、操作步骤或关键参数", "timestamp": "P1 02:30" }
      ],
      "relations": [
        { "targetId": "node_yy", "type": "leads_to", "label": "推导出" }
      ]
    }
  ]
}

【关键要求】
1. 信息零丢失：分集数据中出现的知识点必须全部保留，不允许丢弃任何内容。
2. 跨集关联：如果某个概念在多集中出现过，要在 content 或 detailedPoints 中标注来源集数，说明它们之间的联系和演进关系。
3. 同类合并：同一个概念在不同集中的描述要合并到一起，而不是重复罗列。
4. 保留技术深度：content 和 detailedPoints 要有实质内容，不能写空话套话。
5. 时间戳去重：来源集数和时间信息只写在 timestamp 字段中，禁止在 content 和 point 的正文里重复写时间戳（如"P13 00:30"），避免前端重复显示。` },
                        { role: "user", content: `请将以下分集数据融合成「${theme.title}」主题的完整章节：\n\n${relevantData}` }
                    ],
                    model: "deepseek-chat",
                    response_format: { type: "json_object" },
                    temperature: 0.2,
                    max_tokens: 8192
                });

                try {
                    let themeContent = themeCompletion.choices[0].message?.content || '{}';
                    // Auto-repair truncated JSON
                    try { JSON.parse(themeContent); } catch {
                        console.warn(`[Map-Reduce 3/4] 主题「${theme.title}」JSON 被截断，尝试自动补全...`);
                        let openBraces = 0, openBrackets = 0, inString = false, escapeNext = false;
                        for (let i = 0; i < themeContent.length; i++) {
                            const c = themeContent[i];
                            if (escapeNext) { escapeNext = false; continue; }
                            if (c === '\\') { escapeNext = true; continue; }
                            if (c === '"') { inString = !inString; continue; }
                            if (!inString) {
                                if (c === '{') openBraces++; if (c === '}') openBraces--;
                                if (c === '[') openBrackets++; if (c === ']') openBrackets--;
                            }
                        }
                        if (inString) themeContent += '"';
                        while (openBrackets > 0) { themeContent += ']'; openBrackets--; }
                        while (openBraces > 0) { themeContent += '}'; openBraces--; }
                    }
                    const parsedTheme = JSON.parse(themeContent);
                    globalChapters[ti] = {
                        id: parsedTheme.id || theme.id,
                        title: parsedTheme.title || theme.title,
                        nodes: parsedTheme.nodes || []
                    };
                    console.log(`[Map-Reduce 3/4] ✅ 主题「${theme.title}」融合完成，${(parsedTheme.nodes || []).length} 个节点`);
                } catch (e) {
                    console.error(`[Map-Reduce 3/4] ❌ 主题「${theme.title}」解析失败:`, e);
                    globalChapters[ti] = {
                        id: theme.id,
                        title: theme.title,
                        nodes: [{ id: `${theme.id}_fallback`, title: theme.title, type: 'concept', content: theme.description || '融合解析失败', detailedPoints: [], relations: [] }]
                    };
                }
            }));

            // ========== 第 2c 步：术语合并去重 ==========
            await safeUpdateProgress({ step: 'map_reduce', message: '正在整合全局术语词典...', percent: 96, partialResults: results });
            console.log('[Map-Reduce 4/4] 术语合并去重...');

            const allTerms = successResults.flatMap(r => (r.terms || []).map((t: any) => `${t.term}：${t.brief || t.definition || ''}`));
            const uniqueTermsInput = [...new Set(allTerms)].join('\n');

            let globalTerms: any[] = [];
            try {
                const termsCompletion = await openai.chat.completions.create({
                    messages: [
                        {
                            role: "system", content: `你是一名术语词典编纂专家。用户提供了从多集视频中提取的术语列表（可能有重复和不一致）。
你的任务是：去重、合并、统一定义，输出一份精炼的全局术语词典。

【输出格式】纯 JSON，禁止 markdown：
{
  "terms": [
    { "term": "专业术语", "brief": "一句话通俗易懂的解释，让外行人也能秒懂" }
  ]
}

【要求】
1. 合并相同或相似的术语，统一名称。
2. 每个 brief 用大白话解释，避免用术语解释术语。
3. 保留所有不重复的核心术语，数量取决于内容复杂度，不设硬性上下限。` },
                        { role: "user", content: `以下是从 ${results.length} 集视频中提取的所有术语，请去重合并：\n\n${uniqueTermsInput}` }
                    ],
                    model: "deepseek-chat",
                    response_format: { type: "json_object" },
                    temperature: 0.2,
                    max_tokens: 4096
                });
                const termsResult = JSON.parse(termsCompletion.choices[0].message?.content || '{}');
                globalTerms = termsResult.terms || [];
                console.log(`[Map-Reduce 4/4] ✅ 术语词典合并完成，共 ${globalTerms.length} 个术语`);
            } catch (e) {
                console.warn('[Map-Reduce 4/4] ⚠️ 术语合并失败，使用原始术语合集');
                // 降级：直接用各集术语的去重合集
                const seen = new Set<string>();
                for (const r of results) {
                    for (const t of (r.terms || [])) {
                        if (!seen.has(t.term)) {
                            seen.add(t.term);
                            globalTerms.push(t);
                        }
                    }
                }
            }

            // ========== 组装 P0 Result ==========
            results.unshift({
                index: 0,
                title: globalTitle,
                overview: globalOverview,
                status: 'success',
                chapters: globalChapters,
                terms: globalTerms
            });
            console.log(`✅ 多步 Map-Reduce 流水线完成！P0 已生成：${globalChapters.length} 个主题章节，${globalTerms.length} 个术语`);
        } catch (e) {
            console.error('全局归纳生成失败，退回为普通多集显示:', e);
        }
    }

    // Formatting phase
    console.log('---> 开始合并处理格式');
    await safeUpdateProgress({ step: 'formatting', message: '正在编排输出并打包...等待剩余后台文件', percent: 97, partialResults: results });

    // Wait for all background video downloads to finish before ZIP formatting
    if (videoDownloadPromises.length > 0) {
        console.log(`⏳ 兜底等待剩余的后台视频下载任务完成...`);
        await Promise.allSettled(videoDownloadPromises);
        console.log('✅ 所有视频下载任务已确认结束。');
    }

    let playlistZipUrl = null;
    if (job.data.formats?.downloadVideo && results.length > 1) {
        try {
            console.log(`正在打包 ${results.length} 个本地视频缓存文件...`);
            const validFiles = results.filter(r => r.status === 'success' && r.localPath);

            if (validFiles.length > 0) {
                const archiver = require('archiver');
                const publicDir = path.join(process.cwd(), 'public', 'downloads');
                const zipFileName = `BiliBrain_Package_${job.id}.zip`;
                const zipPath = path.join(publicDir, zipFileName);

                await new Promise<void>((resolve, reject) => {
                    const output = fs.createWriteStream(zipPath);
                    const archive = archiver('zip', {
                        zlib: { level: 9 } // Sets the compression level.
                    });

                    output.on('close', function () {
                        console.log(`一键打包压缩文件生成完成: ${zipPath} (${archive.pointer()} total bytes)`);
                        playlistZipUrl = `/tools/brainflow/downloads/${zipFileName}`;
                        resolve();
                    });

                    archive.on('error', function (err: any) {
                        reject(err);
                    });

                    archive.pipe(output);

                    validFiles.forEach(r => {
                        if (fs.existsSync(r.localPath)) {
                            archive.file(r.localPath, { name: path.basename(r.localPath) });
                        }
                    });

                    archive.finalize();
                });
            }
        } catch (zipError) {
            console.error('ZIP 打包失败，跳过打包环节: ', zipError);
        }
    }

    await safeUpdateProgress({ step: 'done', message: '处理完成！', percent: 100, partialResults: results });
    console.log(`[JOB 结束] 任务 ID: ${job.id} 完美处理完成！\n===========================================`);

    return {
        success: true,
        results: results,
        formats: job.data.formats,
        playlistZipUrl: playlistZipUrl
    };
}, { connection, concurrency: 2 }); // 同时处理 2 个用户任务

worker.on('failed', (job, err) => {
    console.error(`[重大错误] Job ${job?.id} 彻底执行失败:`, err);
});
