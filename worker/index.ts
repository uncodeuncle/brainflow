import { Worker, Job, Queue } from 'bullmq';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import { jsonrepair } from 'jsonrepair';
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
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
};

// ================================================
// 📚 书籍智能识别与章节分拆工具集
// ================================================

interface ChapterHint { title: string; start_hint: string; }
interface BookPreflightResult {
    split_recommended: boolean;
    doc_type: string;
    split_reason: string;
    chapters: ChapterHint[];
}

async function runBookPreflight(fullText: string, apiKey: string): Promise<BookPreflightResult> {
    const FALLBACK: BookPreflightResult = { split_recommended: false, doc_type: '文章', split_reason: '默认不拆分', chapters: [] };
    if (fullText.length < 8000) return FALLBACK;

    const headerPatterns = [
        /第[一二三四五六七八九十\d]+章[\s：:].{2,20}/g,
        /Chapter\s+\d+[\s:].{2,40}/gi,
        /^\d{1,2}\.\d?\s+[\u4e00-\u9fa5A-Za-z].{2,30}/gm,
        /^[一二三四五六七八九十]、[\s：:].{2,20}/gm,
        /^[一二三四五六七八九十][．.\.]\s+.{2,20}/gm,
    ];
    const detectedHeaders: string[] = [];
    for (const pat of headerPatterns) {
        const hits = fullText.match(pat) || [];
        detectedHeaders.push(...hits.slice(0, 100)); // 放宽到 100 章，保证能覆盖全书
    }
    if (detectedHeaders.length < 2) return FALLBACK;

    try {
        const openai = new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey });
        const snippet = fullText.slice(0, 3000);
        const prompt = `以下是一份文档的元信息：
• 总字数：${fullText.length} 字
• 正则初步扫描到的可能章节标题 (${detectedHeaders.length} 个):
  ${detectedHeaders.join('\n  ')}
• 文档开头部分：
${snippet}

请严格仅输出如下 JSON，不包含任何其他文字：
{
  "split_recommended": <按章节拆分解读比整体解读更有价值则为 true，否则 false>,
  "doc_type": "<书籍|学术论文|技术报告|会议纪要|文章|其他>",
  "split_reason": "<简短说明为什么值得或不值得拆分>",
  "chapters": [
    { "title": "<精简后的章节名，如:第一章 乱世浮萍>", "start_hint": "<直接原封不动抄写上面提供的对应的正则扫描标题，作为定位标志>" }
  ]
}
注意：请对正则扫描到的标题进行清洗过滤，去掉明显不是标题的杂音，将真正的章节名填入 chapters。start_hint 必须是你认为对应的原本的标题字符串内容。`;
        const resp = await openai.chat.completions.create({
            model: 'deepseek-chat',
            response_format: { type: 'json_object' },
            max_tokens: 1024,
            messages: [
                { role: 'system', content: '你是一名文档类型分析专家。只输出指定的 JSON，禁止任何其他文字。' },
                { role: 'user', content: prompt }
            ]
        });
        const parsed = JSON.parse(jsonrepair(resp.choices[0].message.content || '{}'));
        if (parsed.split_recommended && Array.isArray(parsed.chapters) && parsed.chapters.length >= 2) {
            return parsed as BookPreflightResult;
        }
        return { ...FALLBACK, doc_type: parsed.doc_type || '文章', split_reason: parsed.split_reason || '' };
    } catch {
        return FALLBACK;
    }
}

function splitTextByChapters(fullText: string, chapters: ChapterHint[]): { title: string; text: string }[] {
    const positions: { title: string; pos: number }[] = [];
    for (const ch of chapters) {
        const hint = ch.start_hint?.trim();
        if (!hint) continue;
        const idx = fullText.indexOf(hint);
        if (idx !== -1) positions.push({ title: ch.title, pos: idx });
    }
    if (positions.length < 2) return [{ title: chapters[0]?.title || '全文', text: fullText }];
    positions.sort((a, b) => a.pos - b.pos);
    return positions.map((p, i) => ({
        title: p.title,
        text: fullText.slice(p.pos, positions[i + 1]?.pos ?? fullText.length)
    }));
}


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

console.log("启动 BrainFlow 后台任务队列处理模块 (Worker)...等待任务接入中...");

const worker = new Worker('bili-extract', async (job: Job) => {
    console.log(`\n===========================================`)
    console.log(`[JOB 启动] 收到新任务 ID: ${job.id}`);
    console.log(`待处理的 P 数量: ${job.data.items?.length}, 需要输出格式: markdown:${job.data.formats.markdown} marp:${job.data.formats.marp} mermaid:${job.data.formats.mermaid}`);

    await job.updateProgress({ step: 'init', message: '正在排队中...', percent: 5 });

    const items = job.data.items || [];
    const results: any[] = [];
    // --- 科学进度模型配置 ---
    const PROGRESS_CONFIG = {
        GLOBAL: { INIT: 5, PROCESSING: 80, POST_MAPREDUCE: 10, POST_ZIP: 5 },
        ITEM_PHASE: {
            ID: 0.1,      // 识别/元数据
            EXTRACT: 0.3, // 提取结构化文本 (ASR/字幕)
            BRAIN: 0.6    // 深度知识萃取 (AI 分析)
        }
    };

    let progressHWM = 5; // 进度水位线（只升不降）
    const safeUpdateProgress = async (data: any) => {
        if (data.percent != null) {
            // 安全熔断：非 done 阶段最高 99
            if (data.step !== 'done' && data.percent >= 100) data.percent = 99;
            data.percent = Math.max(data.percent, progressHWM);
            progressHWM = data.percent;
        } else {
            data.percent = progressHWM;
        }
        await job.updateProgress(data);
    };

    /**
     * @param itemIndex 当前分P索引 (0-indexed)
     * @param phase 环节 (ID / EXTRACT / BRAIN)
     * @param subPercent 该环节内部进度 (0-100)
     */
    const getPercent = (itemIndex: number, phase: keyof typeof PROGRESS_CONFIG.ITEM_PHASE, subPercent: number = 0) => {
        const itemFullWeight = PROGRESS_CONFIG.GLOBAL.PROCESSING / (items.length || 1);
        const itemStartPercent = PROGRESS_CONFIG.GLOBAL.INIT + (itemIndex * itemFullWeight);

        let phaseOffset = 0;
        if (phase === 'EXTRACT') phaseOffset = PROGRESS_CONFIG.ITEM_PHASE.ID;
        if (phase === 'BRAIN') phaseOffset = PROGRESS_CONFIG.ITEM_PHASE.ID + PROGRESS_CONFIG.ITEM_PHASE.EXTRACT;

        const phaseWeight = PROGRESS_CONFIG.ITEM_PHASE[phase];
        const currentProgress = itemStartPercent + (itemFullWeight * (phaseOffset + (phaseWeight * (subPercent / 100))));

        return Math.round(currentProgress);
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
            const safeTitle = item.title.replace(/[\\/:*?"<>|]/g, '_');
            const expectedBaseName = `J${job.id}_${safeTitle}_P${item.index}`;
            const isVideoIncluded = job.data.formats?.downloadVideo;

            console.log(`\n---> 开始处理 P${item.index} : ${item.title}`);
            await safeUpdateProgress({ step: 'download', p: item.index, title: item.title, message: '内容识别中...', percent: getPercent(i, 'ID', 0), partialResults: results });


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

                const rawUrl = job.data.url;
                let parsedUrl: URL;
                try {
                    parsedUrl = new URL(rawUrl);
                } catch (e) {
                    throw new Error(`无法解析该链接，请提供标准的网址 (Invalid URL: ${rawUrl})`);
                }
                const isBilibili = parsedUrl.hostname.includes('bilibili.com') || parsedUrl.hostname.includes('b23.tv');
                const cleanUrl = isBilibili ? `${parsedUrl.origin}${parsedUrl.pathname}` : rawUrl;

                // Only add local bin to PATH on Windows
                const env = { ...process.env };
                if (isWin) {
                    const ffmpegPath = path.join(process.cwd(), 'bin');
                    env.PATH = `${ffmpegPath};${process.env.PATH}`;
                }
                const isVideoIncludedLocal = job.data.formats?.downloadVideo;

                const resultObj: any = {
                    index: item.index,
                    title: item.title,
                    status: 'success',
                };

                // ======== 智能字幕获取 (字幕优先，音频降级) ========
                let fullText = '';
                let transcriptionMethod = '';

                // SESSDATA: 1) 用户扫码存 localStorage → 前端传入 2) .env 环境变量
                const rawSessdata = job.data.sessdata || process.env.BILIBILI_SESSION_TOKEN?.replace(/['"]/g, '').trim();
                // 必须进行 URI 编码，防止用户传入的 SESSDATA 带有分号、逗号、星号等导致解析 Cookie 失败并返回 -412
                const sessdata = rawSessdata ? encodeURIComponent(decodeURIComponent(rawSessdata)) : undefined;

                let isLocalTask = job.data.type === 'local' || !!item.localOssUrl;
                let localRawFilePath = '';
                let localExtension = '';

                // 【分支一：本地上传直通车】
                if (isLocalTask) {
                    console.log(`[P${item.index}] 🏠 检测到本地上传任务，开始直接从 OSS 拉取源文件...`);
                    await safeUpdateProgress({ step: 'download', p: item.index, message: '内容识别中...', percent: getPercent(i, 'ID', 50), partialResults: results });

                    const ossUrlMatch = item.localOssUrl?.match(/^oss:\/\/[^\/]+\/(.+)$/);
                    if (!ossUrlMatch) throw new Error("无效的本地 OSS URL: " + item.localOssUrl);
                    const objectName = ossUrlMatch[1];
                    localExtension = path.extname(objectName).toLowerCase();
                    localRawFilePath = path.join(hiddenDir, `${expectedBaseName}_raw${localExtension}`);

                    await mediaSemaphore.acquire();
                    try {
                        const cleanRegion = (process.env.ALIYUN_OSS_REGION || '').replace(/['"]/g, '').replace('.aliyuncs.com', '').trim();
                        const cleanBucket = (process.env.ALIYUN_OSS_BUCKET || '').replace(/['"]/g, '').trim().replace(/[^a-z0-9-]/g, '');
                        const client = new OSS({ region: cleanRegion, accessKeyId: cleanKeyId, accessKeySecret: cleanKeySecret, bucket: cleanBucket, secure: true });
                        let downloadSuccess = false;
                        let lastErr = null;
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            try {
                                console.log(`[P${item.index}] 尝试从 OSS 拉取本地源文件 (第 ${attempt}/3 次)...`);
                                await client.get(objectName, localRawFilePath);
                                console.log(`[P${item.index}] ✅ 成功拉取本地源文件: ${localRawFilePath}`);
                                downloadSuccess = true;
                                break;
                            } catch (err: any) {
                                lastErr = err;
                                console.warn(`[P${item.index}] ⚠️ OSS 拉取失败 (第 ${attempt}/3 次): ${err.message || String(err)}`);
                                if (attempt < 3) {
                                    const delay = attempt * 2000;
                                    console.log(`[P${item.index}] ⏳ 等待 ${delay}ms 后重试...`);
                                    await new Promise(r => setTimeout(r, delay));
                                }
                            }
                        }
                        if (!downloadSuccess) {
                            throw new Error(`从 OSS 拉取上传文件失败 (已重试3次): ${String(lastErr)}`);
                        }
                    } finally {
                        mediaSemaphore.release();
                    }

                    const textExtensions = ['.txt', '.md', '.csv', '.srt', '.vtt'];
                    const docExtensions = ['.pdf', '.docx', '.doc'];

                    if (textExtensions.includes(localExtension)) {
                        fullText = fs.readFileSync(localRawFilePath, 'utf-8');
                        if (['.srt', '.vtt'].includes(localExtension)) {
                            fullText = fullText
                                .replace(/^\d+\s*$/gm, '')
                                .replace(/(?:(?:00:)?(\d{2}:\d{2})|(\d{1,2}:\d{2}:\d{2}))[,.]\d{3}\s*-->\s*[\d:.,]+/g, (match, mmss, hhmmss) => `[${mmss || hhmmss}]`)
                                .replace(/<{1}[^>]+>{1}/g, '')
                                .replace(/\n{2,}/g, ' ')
                                .trim();
                        }
                        transcriptionMethod = 'local_text';
                        console.log(`[P${item.index}] 📝 纯文本解析完成 (${fullText.length} 字符)`);
                    } else if (docExtensions.includes(localExtension)) {
                        if (localExtension === '.pdf') {
                            const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
                            const dataBuffer = fs.readFileSync(localRawFilePath);
                            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) });
                            const pdfDoc = await loadingTask.promise;
                            const pageTexts: string[] = [];
                            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                                const page = await pdfDoc.getPage(pageNum);
                                const textContent = await page.getTextContent();
                                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                                pageTexts.push(pageText);
                            }
                            fullText = pageTexts.join('\n');
                        } else if (localExtension === '.docx') {
                            const { default: mammoth } = await import('mammoth');
                            const result = await mammoth.extractRawText({ path: localRawFilePath });
                            fullText = result.value;
                        } else {
                            throw new Error("暂不支持 .doc 格式，请用 .docx 或 PDF");
                        }
                        transcriptionMethod = 'local_document';
                        console.log(`[P${item.index}] 📝 文档解析完成 (${fullText.length} 字符)`);
                    }
                }

                // 【分支二：网络链接抽取】
                let realBvid = '';
                let realPage = 1; // 视频内部的分P号 (1-based)

                if (!isLocalTask) {
                    // 【核心修复】：解析 item.id 中的 BV号 和 分P号
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

                    await safeUpdateProgress({ step: 'transcribe', p: item.index, message: '提取核心信息...', percent: getPercent(i, 'ID', 100), partialResults: results });

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
                        await safeUpdateProgress({ step: 'transcribe', p: item.index, message: '提取核心信息...', percent: getPercent(i, 'EXTRACT', 10), partialResults: results });

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
                                // 清洗 SRT 格式：去掉序号，保留开始时间为 [MM:SS]
                                fullText = subContent
                                    .replace(/^\d+\s*$/gm, '')              // 序号行
                                    .replace(/(?:(?:00:)?(\d{2}:\d{2})|(\d{1,2}:\d{2}:\d{2}))[,.]\d{3}\s*-->\s*[\d:.,]+/g, (match, mmss, hhmmss) => `[${mmss || hhmmss}]`) // 时间戳行
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

                } // ← end of !isLocalTask block

                // --------------- 优先级三：兜底 - 下载音频 + DashScope Paraformer 转录 (按量计费) ---------------
                if (!fullText || fullText.length < 50) {
                    console.log(`[P${item.index}] ⚠️ 字幕均不可用，降级到 DashScope Paraformer 极速语音大模型识别...`);
                    await safeUpdateProgress({ step: 'download', p: item.index, message: '提取结构化文本...', percent: getPercent(i, 'EXTRACT', 20), partialResults: results });

                    // Audio extraction via 原生 API (bypasses yt-dlp 412)
                    // 带宽密集段：下载 + FFmpeg + OSS 上传 → 完成后释放 media slot
                    let audioResolvedFileName = `${expectedBaseName}_16k.mp3`;
                    let audioActualFilePath = path.join(hiddenDir, audioResolvedFileName);
                    let rawAudioFilePath = '';

                    await mediaSemaphore.acquire(); // 获取媒体 slot
                    try {
                        if (isLocalTask) {
                            rawAudioFilePath = localRawFilePath;
                            console.log(`[P${item.index}] 🔊 本地音频/视频文件已就绪，准备进入 Paraformer 语音识别管道...`);
                        } else if (realBvid) {
                            console.log(`[P${item.index}] 🔊 通过原生 API 下载音频用于 Paraformer 语音识别 (B站高速通道)...`);
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
                        await safeUpdateProgress({ step: 'upload', p: item.index, message: '上传中...', percent: getPercent(i, 'EXTRACT', 40), partialResults: results });

                        const cleanRegion = (process.env.ALIYUN_OSS_REGION || '').replace(/['"]/g, '').replace('.aliyuncs.com', '').trim();
                        const cleanBucket = (process.env.ALIYUN_OSS_BUCKET || '').replace(/['"]/g, '').trim().replace(/[^a-z0-9-]/g, '');
                        const client = new OSS({ region: cleanRegion, accessKeyId: cleanKeyId, accessKeySecret: cleanKeySecret, bucket: cleanBucket, secure: true });
                        const ossObjectName = `brainflow-audio/${Date.now()}_${audioResolvedFileName}`;
                        await client.put(ossObjectName, audioActualFilePath);
                        const signedUrl = client.signatureUrl(ossObjectName, { expires: 14400 });
                        resultObj.ossAudioUrl = signedUrl;
                    } finally {
                        mediaSemaphore.release(); // ⚠️ 上传完就释放 slot，Paraformer 轮询不占带宽
                    }

                    // 以下是纯 API 轮询，不占 media slot

                    // DashScope Paraformer Transcription
                    // See API Docs: https://help.aliyun.com/zh/model-studio/developer-reference/record-file-recognition
                    console.log('正在提交阿里云 DashScope (Paraformer) 录音文件识别任务...');
                    await safeUpdateProgress({ step: 'transcribe', p: item.index, message: '提取结构化文本...', percent: getPercent(i, 'EXTRACT', 50), partialResults: results });

                    const dashscopeKey = (process.env.DASHSCOPE_API_KEY as string)?.replace(/['"]/g, '').trim();

                    if (!dashscopeKey) {
                        console.error(`[P${item.index}] ❌ 缺少 DASHSCOPE_API_KEY 环境变量`);
                        fullText = `[此视频无法提取文字] 缺少 DASHSCOPE_API_KEY 配置。请在 .env 中填写阿里云百炼 API Key。`;
                        transcriptionMethod = 'missing_dashscope_key';
                    } else {
                        // 1. Submit async transcription task
                        const submitRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${dashscopeKey}`,
                                'Content-Type': 'application/json',
                                'X-DashScope-Async': 'enable' // Must be async for file URLs
                            },
                            body: JSON.stringify({
                                model: 'paraformer-8k-v2', // Best general model for video audio, handles mixed languages
                                parameters: {},
                                input: {
                                    file_urls: [resultObj.ossAudioUrl]
                                }
                            })
                        });

                        const submitData = await submitRes.json();
                        const taskId = submitData.output?.task_id;

                        if (!submitRes.ok || !taskId) {
                            console.error(`[P${item.index}] ❌ DashScope 任务提交失败: ${JSON.stringify(submitData)}`);
                            fullText = `[提取文字失败] 语音大模型拒绝了请求：${submitData.message || '未知异常'}。`;
                            transcriptionMethod = 'dashscope_submit_failed';
                        } else {
                            // 2. Poll for results
                            let transcriptionResult: any = null;
                            let pollCount = 0;
                            while (pollCount < 60) {
                                await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
                                pollCount++;

                                const statusRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
                                    method: 'GET',
                                    headers: { 'Authorization': `Bearer ${dashscopeKey}` }
                                });
                                const statusData = await statusRes.json();

                                if (statusData.output?.task_status === 'SUCCEEDED') {
                                    transcriptionResult = statusData.output.results?.[0];
                                    break;
                                } else if (statusData.output?.task_status === 'FAILED') {
                                    throw new Error(`DashScope 转录失败: ${JSON.stringify(statusData)}`);
                                } else if (statusData.output?.task_status === 'CANCELED') {
                                    throw new Error("DashScope 任务被意外取消");
                                }

                                await safeUpdateProgress({ step: 'transcribe', p: item.index, message: `内容分析中...`, percent: getPercent(i, 'BRAIN', 0), partialResults: results });
                            }

                            if (!transcriptionResult) throw new Error("DashScope 大模型转录超时");

                            if (transcriptionResult) {
                                // Paraformer returns a URL containing the actual transcript JSON
                                const transUrl = transcriptionResult.transcription_url;
                                if (transUrl) {
                                    try {
                                        const transRes = await fetch(transUrl);
                                        const transData = await transRes.json();
                                        const transcripts = transData.transcripts || [];
                                        fullText = transcripts.map((t: any) => {
                                            const sentences = t.sentences || [];
                                            if (sentences.length > 0) {
                                                return sentences.map((s: any) => {
                                                    let text = s.text || "";
                                                    if (s.begin_time !== undefined) {
                                                        const totalSeconds = Math.floor(s.begin_time / 1000);
                                                        const minutes = Math.floor(totalSeconds / 60);
                                                        const seconds = totalSeconds % 60;
                                                        const timeStr = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
                                                        return `${timeStr} ${text}`;
                                                    }
                                                    return text;
                                                }).join('\n');
                                            } else {
                                                let text = t.text || "";
                                                if (t.begin_time !== undefined) {
                                                    const totalSeconds = Math.floor(t.begin_time / 1000);
                                                    const minutes = Math.floor(totalSeconds / 60);
                                                    const seconds = totalSeconds % 60;
                                                    const timeStr = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
                                                    return `${timeStr} ${text}`;
                                                }
                                                return text;
                                            }
                                        }).join('\n') || "转录结果为空";
                                    } catch (e) {
                                        console.error(`[P${item.index}] 提取实际转录结果失败:`, e);
                                        fullText = "转录结果文件下载失败";
                                    }
                                } else {
                                    fullText = "转录结果无效或 URL 为空";
                                }
                                transcriptionMethod = 'paraformer_v2';
                            }
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
                            if (isLocalTask) {
                                const isVideo = ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.wmv', '.webm', '.m4v'].includes(localExtension);
                                if (isVideo) {
                                    console.log(`[P${item.index}] 🎬 本地视频：拷贝本地缓冲用于打包分发...`);
                                    const mergedPath = path.join(publicDir, `${expectedBaseName}.mp4`);
                                    try {
                                        await execAsync(`ffmpeg -y -i "${localRawFilePath}" -c copy "${mergedPath}"`, { env });
                                    } catch (err: any) {
                                        console.log(`[P${item.index}] FFmpeg快速容器写入失败，退化为直接拷贝...`);
                                        fs.copyFileSync(localRawFilePath, mergedPath);
                                    }
                                    resultObj.videoUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/downloads/${expectedBaseName}.mp4`;
                                    resultObj.localPath = mergedPath;
                                }
                            } else if (realBvid) {
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
                                resultObj.videoUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/downloads/${expectedBaseName}.mp4`;
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

                // ======== 📚 书籍章节智能拆分（仅对本地文档且字数足够时触发）========
                let isBookExpanded = false;
                const isDocumentType = ['local_text', 'local_document'].includes(transcriptionMethod);
                if (isLocalTask && isDocumentType && fullText.length >= 8000) {
                    const deepseekKey = (process.env.DEEPSEEK_API_KEY as string)?.replace(/['\"]/g, '').trim();
                    if (deepseekKey) {
                        console.log(`[P${item.index}] 📚 启动书籍识别探针 (${fullText.length} 字)...`);
                        await safeUpdateProgress({ step: 'book_preflight', p: item.index, message: '内容分析中...', percent: getPercent(i, 'BRAIN', 10), partialResults: results });

                        const preflight = await runBookPreflight(fullText, deepseekKey);
                        console.log(`[P${item.index}] 📚 探针结果: doc_type=${preflight.doc_type}, split=${preflight.split_recommended}, reason=${preflight.split_reason}`);

                        if (preflight.split_recommended && preflight.chapters.length >= 2) {
                            const openai = new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: deepseekKey });
                            const chapterTexts = splitTextByChapters(fullText, preflight.chapters);
                            console.log(`[P${item.index}] 📚 已切割为 ${chapterTexts.length} 个章节，开始逐章提取知识...`);
                            isBookExpanded = true;

                            // 把原始 resultObj 出栈（未 push 时不用弹，直接放弃）
                            // 为每个章节独立生成结果
                            for (let ci = 0; ci < chapterTexts.length; ci++) {
                                const chap = chapterTexts[ci];
                                // 用一个全局 index 偏移保证不与其他 items 冲突, 比如 item=1 时，章节 index 为 1001, 1002...
                                const chapIndex = item.index * 1000 + ci + 1;
                                const chapResult: any = {
                                    id: `${item.id}_ch${ci}`,
                                    index: chapIndex,
                                    title: chap.title,
                                    docType: preflight.doc_type,
                                    transcriptionMethod: `book_chapter (${preflight.doc_type})`,
                                    status: 'success',
                                    error: null,
                                };
                                try {
                                    await safeUpdateProgress({ step: 'ai_brain', p: chapIndex, message: `知识萃取中...`, percent: getPercent(i, 'BRAIN', 20 + 80 * ((ci + 1) / chapterTexts.length)), partialResults: results });
                                    const systemPrompt = `你是一名极度理性的专属知识库架构师。\n核心任务是将书籍章节内容萃取为原子化、**树状层级**的知识卡片流 (Card Flow)。\n该章节来自《${item.title}》的"${chap.title}"部分。\n【格式要求】必须严格输出纯 JSON，禁止任何 Markdown 代码块包装，直接以 { 开始。\n{"chapters":[{"id":"chapter_01","title":"<高度归纳的本章核心议题>","nodes":[{"id":"card_01","title":"节点标题","type":"concept","content":"核心概述","detailedPoints":[{"point":"具体细节"}],"relations":[]}]}],"terms":[{"term":"专业词","brief":"解释"}]}`;
                                    const completion = await openai.chat.completions.create({
                                        messages: [
                                            { role: 'system', content: systemPrompt },
                                            { role: 'user', content: `【章节标题】：${chap.title}\n\n${chap.text}` }
                                        ],
                                        model: 'deepseek-chat',
                                        response_format: { type: 'json_object' },
                                        max_tokens: 8192
                                    });
                                    const rawContent = completion.choices[0].message.content || '{}';
                                    chapResult.summary = rawContent;
                                    const parsed = JSON.parse(jsonrepair(rawContent));
                                    chapResult.chapters = parsed.chapters || [];
                                    chapResult.terms = parsed.terms || [];
                                    console.log(`[P${item.index}→Ch${ci + 1}] ✅ 章节「${chap.title}」提取成功`);
                                } catch (chapErr: any) {
                                    chapResult.error = chapErr.message;
                                    console.error(`[P${item.index}→Ch${ci + 1}] ❌ 章节提取失败: ${chapErr.message}`);
                                }
                                results.push(chapResult);
                                results.sort((a, b) => a.index - b.index);
                                await safeUpdateProgress({ step: 'ai_brain_done', p: chapIndex, message: `${chap.title} 提取完成`, percent: getPercent(i, 'BRAIN', 20 + 80 * ((ci + 1) / chapterTexts.length)), partialResults: results });
                            }
                        }
                    }
                }

                // Phase 6: DeepSeek API Integration
                // 字幕极短时跳过 AI 分析，避免 DeepSeek 返回空 chapters
                if (isBookExpanded) {
                    // 书籍已展开为多个章节结果，跳过单卡片分析
                    console.log(`[P${item.index}] 📚 书籍拆分模式已完成，跳过单卡片流程`);
                } else if (fullText.length < 100 || fullText.startsWith('[此视频无')) {

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
                    await safeUpdateProgress({ step: 'ai_brain', p: item.index, message: '知识萃取中...', percent: getPercent(i, 'BRAIN', 100), partialResults: results });

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

                        // 动态切换知识库架构提示词，支持自由时间提取
                        const systemPrompt = `你是一名极度理性的专属知识库架构师。
核心任务是将${isLocalTask ? '本地上传的多模态资源（如视频、会议纪要或纯文图资料）' : '视频文稿'}萃取为原子化、**树状层级**的知识卡片流 (Card Flow)。

【时间戳动态处理指令】
识别输入内容的格式属性：如果内容存在明显的时间流标志（如字幕自带时间前缀像 [02:30]、1:23:45 甚至 "此时此刻" 等暗示时间轴的字眼），你必须在知识节点下提炼规整的 [MM:SS] 时间戳用于 timestamp 字段。
如果整段文稿是纯阅读向的材料、论文或无时间顺序的纪要，请忽略 timestamp 字段并且【严禁】为了迎合结构强行编造 [00:00]。

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
                            response_format: { type: "json_object" },
                            max_tokens: 8192
                        });

                        const rawContent = completion.choices[0].message.content || '{}';
                        resultObj.summary = rawContent;
                        try {
                            const parsed = JSON.parse(jsonrepair(rawContent));
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

                if (!isBookExpanded) {
                    results.push(resultObj);
                    // 【关键修改：提前将局部结果通过 progress 传递给前台】
                    results.sort((a, b) => a.index - b.index); // 确保并发下局部结果依然有序
                    await safeUpdateProgress({
                        step: 'ai_brain_done',
                        p: item.index,
                        message: `P${item.index} 知识萃取完成`,
                        percent: getPercent(i, 'BRAIN', 100),
                        partialResults: results // 将目前所有已解析成功的 P 传给前台以便提前渲染
                    });
                }

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

            const firstDocType = successResults[0]?.docType || '';
            const isDocumentMR = firstDocType.includes('书籍') || firstDocType.includes('文章') || firstDocType.includes('文档') || firstDocType.includes('文本');
            const contentType = isDocumentMR ? '长篇文档或书籍的章节集' : '系列视频';

            // ========== 第一步：轻量调用生成 title + overview ==========
            await safeUpdateProgress({ step: 'map_reduce', message: '内容分析中...', percent: 85 + PROGRESS_CONFIG.GLOBAL.POST_MAPREDUCE * 0.2, partialResults: results });
            console.log('[Map-Reduce 1/4] 生成合集 title + overview...');

            // 构建精华骨架：只取成功的分P
            const skeletonInput = successResults.map(r => {
                const chapterTitles = (r.chapters || []).map((ch: any) => ch.title).join(' / ');
                const termNames = (r.terms || []).map((t: any) => t.term).join('、');
                return `[第${r.index}部分 ${r.title}]\n章节：${chapterTitles || '无'}\n术语：${termNames || '无'}`;
            }).join('\n\n');

            const titleOverviewCompletion = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system", content: `你是一名内容概括专家。请根据用户提供的${contentType}骨架信息，输出纯 JSON（禁止 markdown），格式如下：
{
  "title": "用一句话概括这个合集的核心主题（精炼、有概括力，不超过20字）",
  "overview": "用2-3句话简要概述整个合集的核心内容和精华，让读者快速了解这个系列讲了什么、主旨是什么。控制在80字以内。"
}` },
                    { role: "user", content: `以下是一个包含 ${successResults.length} 个部分的${contentType}结构概览：\n\n${skeletonInput}` }
                ],
                model: "deepseek-chat",
                response_format: { type: "json_object" },
                temperature: 0.3,
                max_tokens: 512
            });

            let globalTitle = '全集总览';
            let globalOverview = '';
            try {
                const toResult = JSON.parse(jsonrepair(titleOverviewCompletion.choices[0].message?.content || '{}'));
                globalTitle = toResult.title || globalTitle;
                globalOverview = toResult.overview || globalOverview;
                console.log(`[Map-Reduce 1/4] ✅ title="${globalTitle}", overview="${globalOverview}"`);
            } catch (e) {
                console.warn('[Map-Reduce 1/4] ⚠️ title/overview 解析失败，使用默认值');
            }

            // ========== 第 2a 步：结构规划 —— 识别跨集宏观主题 ==========
            await safeUpdateProgress({ step: 'map_reduce', message: '规划跨集知识结构...', percent: 85 + PROGRESS_CONFIG.GLOBAL.POST_MAPREDUCE * 0.5, partialResults: results });
            console.log('[Map-Reduce 2/4] 结构规划：识别跨集主题骨架...');

            const allSummaries = successResults.map(r => `[第${r.index}部分 ${r.title}]\n` + JSON.stringify(r.chapters)).join('\n\n');
            const safeAllSummaries = limitTextByteLength(allSummaries, 60000);
            const validSourceIndexes = successResults.map(r => r.index);
            const exampleSources = validSourceIndexes.slice(0, 2).join(', ');

            const planningCompletion = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system", content: `你是一名宏观知识架构师。用户提供了一个${contentType}的所有部分的结构化数据。
你的任务是：梳理这批内容的逻辑脉络，**完全自主决定**划分为几个宏观知识主题。**不要受拘束于任意固定的主题数量**。
- 如果这是一门从头到尾结构严密的系统课，请直接将它们融合成少数几个（如 1-3 个）真正具备全局纵深的超级大模块。
- 如果这里面涉及了多个完全跳跃、独立的知识切面，请果断拆分出相应的独立架构（即使有十几个模块也可以）。
唯一准则：模块数量只取决于内容的知识跨度和逻辑转换点。宁要厚重的一篇，不要为了拆分而拆解出的凑数章节。

【输出格式】纯 JSON，禁止 markdown：
{
  "themes": [
    {
      "id": "theme_01",
      "title": "宏观主题名称（高度归纳）",
      "description": "一句话说明这个主题涵盖什么",
      "sources": [${exampleSources}] // 必须严格从提供的数字池 [${validSourceIndexes.join(', ')}] 中选取，代表涵盖了哪些部分。绝对禁止编造任何不存在的数字。
    }
  ]
}

【铁律】
1. 每一个部分必须至少被一个主题覆盖，不允许遗漏任何一个部分。
2. 同一个部分可以出现在多个主题中（如果它的内容横跨多个主题）。
3. 主题划分要有逻辑层次感，不要只是把原来的部分重新编号。要真正做到"打碎重组"。
4. 只输出规划骨架，不要输出任何详细内容。` },
                    { role: "user", content: `以下是 ${successResults.length} 个部分的完整结构化数据，请分析并输出跨集主题规划：\n\n${safeAllSummaries}` }
                ],
                model: "deepseek-chat",
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 2048
            });

            let themes: any[] = [];
            try {
                const planResult = JSON.parse(jsonrepair(planningCompletion.choices[0].message?.content || '{}'));
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
            await safeUpdateProgress({ step: 'map_reduce', message: `合并主题中...`, percent: 85 + PROGRESS_CONFIG.GLOBAL.POST_MAPREDUCE * 0.7, partialResults: results });

            const globalChapters: any[] = new Array(themes.length);

            await Promise.all(themes.map(async (theme: any, ti: number) => {
                console.log(`[Map-Reduce 3/4] 融合主题 ${ti + 1}/${themes.length}：「${theme.title}」(来源: P${(theme.sources || []).join(', P')})`);

                // 只传该主题关联的 P 的 chapters 数据
                const sourceIndexes: number[] = theme.sources || [];
                const relevantData = successResults
                    .filter(r => sourceIndexes.includes(r.index))
                    .map(r => `[第${r.index}集 ${r.title}]\n${JSON.stringify(r.chapters)}`)
                    .join('\n\n');

                const firstDocType = successResults[0]?.docType || '';
                const isDocument = firstDocType.includes('书籍') || firstDocType.includes('文章') || firstDocType.includes('文档') || firstDocType.includes('文本');

                const timeStampFormatRule = isDocument ?
                    `"timestamp": "来自 P1001, P1003",
      "detailedPoints": [
        { "point": "具体的技术细节、操作步骤或关键参数", "timestamp": "P1001" }
      ],` :
                    `"timestamp": "来自 P1, P3",
      "detailedPoints": [
        { "point": "具体的技术细节、操作步骤或关键参数", "timestamp": "P1 02:30" }
      ],`;

                const timeStampInstructionRule = isDocument ?
                    `5. 去除伪时间戳：来源出处只写入 timestamp 字段（例如填入 "P1001" 或 "P1001, P1003"）。因为原始分集是一本书或文档，**绝对禁止**擅自编造出分秒时间戳（如 "05:15"），只保留来源集数即可。` :
                    `5. 时间戳去重与防伪：如果原文本身没有具体的分秒时间，timestamp 字段**仅允许写来源集数（如 "P13" 或 "来自 P13, P14"）**。**极其严禁大模型擅自编造 00:00 或任何虚假的分秒时间！** 只有在原文明确提供了具体分秒时才可以拼接到后面（如 "P13 02:30"），且严禁在 content 和 point 正文里重复写时间。`;

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
      ${timeStampFormatRule}
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
${timeStampInstructionRule}`
                        },
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
            await safeUpdateProgress({ step: 'map_reduce', message: '编排输出中...', percent: 85 + PROGRESS_CONFIG.GLOBAL.POST_MAPREDUCE, partialResults: results });
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
                const termsResult = JSON.parse(jsonrepair(termsCompletion.choices[0].message?.content || '{}'));
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
    await safeUpdateProgress({ step: 'formatting', message: '编排输出中...', percent: 95 + PROGRESS_CONFIG.GLOBAL.POST_ZIP * 0.5, partialResults: results });

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
                        playlistZipUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/downloads/${zipFileName}`;
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
