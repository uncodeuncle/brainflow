/**
 * B站字幕直取模块 (WBI 签名版)
 * 
 * 采用 B站最新的 WBI 签名验证机制，调用 /x/player/wbi/v2
 * 代替已废弃的 /x/player/v2，以获取可靠的 AI 字幕数据
 * 
 * WBI 签名算法参考：bilibili-API-collect (SocialSisterYi)
 */

import { createHash } from 'crypto';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// 全局请求队列锁：防止多个并发 P 同时调用 WBI API 触发 -412 限流
let requestLock: Promise<void> = Promise.resolve();
function acquireRequestSlot(): Promise<void> {
    const prev = requestLock;
    let resolve: () => void;
    requestLock = new Promise<void>(r => { resolve = r; });
    return prev.then(() => {
        // 请求之间至少间隔 2000ms，避免 B站 -412 限流
        return new Promise<void>(r => setTimeout(() => { r(); resolve!(); }, 2000));
    });
}

// WBI 混淆密钥重排表 (固定值，B站定义)
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

interface SubtitleItem {
    from: number;
    to: number;
    content: string;
}

interface SubtitleResult {
    success: boolean;
    text: string;
    method: string;
    error?: string;
}

// ============ WBI 签名工具函数 ============

/** 从 img_key 和 sub_key 生成混淆密钥 mixin_key */
function getMixinKey(imgKey: string, subKey: string): string {
    const rawWbiKey = imgKey + subKey;
    return MIXIN_KEY_ENC_TAB
        .map(i => rawWbiKey.charAt(i))
        .join('')
        .substring(0, 32);
}

/** 对请求参数进行 WBI 签名，返回带 w_rid 和 wts 的完整查询字符串 */
function encWbiParams(params: Record<string, string | number>, mixinKey: string): string {
    const wts = Math.floor(Date.now() / 1000);
    const allParams = { ...params, wts };

    // 按 key 字典序排序
    const sortedKeys = Object.keys(allParams).sort();

    // 拼接成 query string (值中过滤特殊字符 !'()*)
    const queryParts = sortedKeys.map(key => {
        const val = String(allParams[key as keyof typeof allParams]).replace(/[!'()*]/g, '');
        return `${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
    });
    const queryString = queryParts.join('&');

    // MD5(queryString + mixinKey) = w_rid
    const wRid = createHash('md5').update(queryString + mixinKey).digest('hex');

    return `${queryString}&w_rid=${wRid}`;
}

// 缓存 WBI keys (每天更新一次即可)
let cachedMixinKey: string | null = null;
let cachedKeyTimestamp = 0;
const KEY_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12小时

/** 从 B站 /x/web-interface/nav 获取 WBI keys */
async function getWbiKeys(headers: Record<string, string>): Promise<string> {
    const now = Date.now();
    if (cachedMixinKey && (now - cachedKeyTimestamp) < KEY_CACHE_DURATION) {
        return cachedMixinKey;
    }

    console.log('[WBI] 正在获取 WBI 签名密钥...');
    const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers });
    const navData = await navRes.json();

    const wbiImg = navData?.data?.wbi_img;
    if (!wbiImg?.img_url || !wbiImg?.sub_url) {
        throw new Error('无法获取 WBI 密钥: nav 接口返回异常');
    }

    // 从 URL 中提取 key (例: https://i0.hdslb.com/bfs/wbi/xxx.png → xxx)
    const imgKey = wbiImg.img_url.split('/').pop()!.split('.')[0];
    const subKey = wbiImg.sub_url.split('/').pop()!.split('.')[0];

    cachedMixinKey = getMixinKey(imgKey, subKey);
    cachedKeyTimestamp = now;
    console.log(`[WBI] 密钥获取成功: imgKey=${imgKey.substring(0, 8)}..., subKey=${subKey.substring(0, 8)}...`);

    return cachedMixinKey;
}

// ============ 字幕获取主函数 ============

function extractBvid(url: string): string | null {
    const bvMatch = url.match(/BV[a-zA-Z0-9]{10}/i);
    return bvMatch ? bvMatch[0] : null;
}

/**
 * 通过 B站 WBI 签名 API 获取视频的字幕文本
 */
export async function fetchBilibiliSubtitle(
    url: string,
    pageIndex: number = 1,
    sessdata?: string
): Promise<SubtitleResult> {
    const bvid = extractBvid(url);
    if (!bvid) {
        return { success: false, text: '', method: 'wbi_api', error: '无法从 URL 中提取 BV 号' };
    }

    const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': `https://www.bilibili.com/video/${bvid}/`,
    };

    if (sessdata) {
        headers['Cookie'] = `SESSDATA=${sessdata}`;
    }

    const fetchOptions: RequestInit = { method: 'GET', headers };

    try {
        // 全局排队：确保多个并发 P 不会同时发请求导致 B站拒绝连接
        await acquireRequestSlot();

        // Step 1: 获取 WBI 签名密钥
        const mixinKey = await getWbiKeys(headers);

        // Step 2: 获取视频基本信息 (aid, cid)
        const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
        console.log(`[字幕直取] Step 1: 请求视频信息 → ${viewUrl}`);

        const viewResponse = await fetch(viewUrl, fetchOptions);
        const viewJson = await viewResponse.json();

        if (viewJson.code !== 0) {
            return { success: false, text: '', method: 'wbi_api', error: `平台 API 错误: code=${viewJson.code}` };
        }

        const { aid, pages } = viewJson.data || {};
        let targetPage = pages?.find((p: any) => p.page === pageIndex);
        if (!targetPage && pages?.length === 1) {
            targetPage = pages[0];
            console.log(`[字幕直取] ⚠️ P 序号不匹配 (请求 P${pageIndex} 但视频只有 1 P), 自动降级读取 P1`);
        }
        if (!targetPage) {
            return { success: false, text: '', method: 'wbi_api', error: `未找到第 ${pageIndex} P` };
        }

        const cid = targetPage.cid;
        console.log(`[字幕直取] Step 1 完成: aid=${aid}, cid=${cid}, P${pageIndex}`);

        // Step 3: 使用 WBI 签名调用 /x/player/wbi/v2
        const signedQuery = encWbiParams({ aid, cid }, mixinKey);
        const playerUrl = `https://api.bilibili.com/x/player/wbi/v2?${signedQuery}`;
        console.log(`[字幕直取] Step 2: 请求字幕列表 (WBI 签名) → ${playerUrl.substring(0, 80)}...`);

        let subtitleList: any[] | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            // 通过全局队列确保请求之间有间隔，避免 -412 限流
            await acquireRequestSlot();

            // 每次重试都重新生成签名（wts 时间戳会变）
            const freshSignedQuery = encWbiParams({ aid, cid }, mixinKey);
            const freshPlayerUrl = `https://api.bilibili.com/x/player/wbi/v2?${freshSignedQuery}`;

            // 在触发 -412 的环境中，打印更底层的调试信息
            console.log(`[DEBUG-FETCH] 发起 WBI 请求 => URL: ${freshPlayerUrl}`);
            console.log(`[DEBUG-FETCH] 发起 WBI 请求 => Headers: ${JSON.stringify(fetchOptions.headers)}`);

            const playerResponse = await fetch(freshPlayerUrl, fetchOptions);
            const playerJson = await playerResponse.json();

            if (playerJson.code !== 0) {
                const is412 = playerJson.code === -412;
                const backoff = is412 ? attempt * 3000 : attempt * 1500;
                console.log(`[字幕直取] WBI 请求返回 code=${playerJson.code}, message=${playerJson.message}${is412 ? ' (限流，等待' + backoff + 'ms)' : ''}`);
                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                return { success: false, text: '', method: 'wbi_api', error: `WBI API 错误: ${playerJson.message}` };
            }

            subtitleList = playerJson?.data?.subtitle?.subtitles;
            if (subtitleList && subtitleList.length > 0) break;

            if (attempt < 3) {
                await new Promise(r => setTimeout(r, attempt * 1500));
            }
        }

        if (!subtitleList || subtitleList.length === 0) {
            return { success: false, text: '', method: 'wbi_api', error: '该视频没有字幕' };
        }

        console.log(`[字幕直取] Step 2 完成: 找到 ${subtitleList.length} 条字幕轨道`);
        for (const s of subtitleList) {
            console.log(`[字幕直取]   - lan=${s.lan}, ai_type=${s.ai_type}, url_len=${s.subtitle_url?.length || 0}`);
        }

        // 选择最佳字幕：优先 zh-CN (UP主上传) → ai-zh (AI生成) → 其他中文
        const betterSubtitle = subtitleList.find((s: any) => s.lan === 'zh-CN' || s.lan === 'zh-Hans')
            || subtitleList.find((s: any) => s.lan === 'ai-zh')
            || subtitleList.find((s: any) => s.lan?.startsWith('zh'))
            || subtitleList[0];

        let subtitleUrl = betterSubtitle?.subtitle_url;
        if (!subtitleUrl) {
            return { success: false, text: '', method: 'wbi_api', error: '字幕 URL 为空' };
        }
        if (subtitleUrl.startsWith('//')) {
            subtitleUrl = `https:${subtitleUrl}`;
        }

        console.log(`[字幕直取] Step 3: 下载字幕 (lan=${betterSubtitle.lan})...`);

        // Step 4: 下载字幕 JSON
        const subtitleResponse = await fetch(subtitleUrl, { headers: { 'User-Agent': USER_AGENT } });
        const subtitleJson = await subtitleResponse.json();

        const body: SubtitleItem[] = subtitleJson?.body;
        if (!body || body.length === 0) {
            return { success: false, text: '', method: 'wbi_api', error: '字幕文件内容为空' };
        }

        const fullText = body.map(item => item.content).join(' ');
        console.log(`[字幕直取] ✅ 成功！共 ${body.length} 条字幕，合计 ${fullText.length} 字符`);

        return { success: true, text: fullText, method: 'bilibili_api' };

    } catch (err: any) {
        console.error(`[字幕直取] 异常:`, err.message);
        return { success: false, text: '', method: 'wbi_api', error: `异常: ${err.message}` };
    }
}

// ============ 媒体流下载 (音频/视频) ============

import { writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

interface MediaResult {
    success: boolean;
    audioPath?: string;
    videoPath?: string;
    error?: string;
}

/**
 * 通过 B站 playurl API 下载音频和/或视频文件
 * 完全绕过 yt-dlp，使用与字幕提取相同的 WBI 签名认证
 */
export async function fetchBilibiliMedia(
    url: string,
    pageIndex: number = 1,
    sessdata: string | undefined,
    outputDir: string,
    baseName: string,
    options: { audio?: boolean; video?: boolean } = { audio: true, video: false }
): Promise<MediaResult> {
    const bvid = extractBvid(url);
    if (!bvid) {
        return { success: false, error: '无法从 URL 中提取 BV 号' };
    }

    const headers: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': `https://www.bilibili.com/video/${bvid}/`,
    };
    if (sessdata) {
        headers['Cookie'] = `SESSDATA=${sessdata}`;
    }

    try {
        await acquireRequestSlot();

        // Step 1: Get aid and cid
        const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
        const viewRes = await fetch(viewUrl, { headers });
        const viewJson = await viewRes.json();
        if (viewJson.code !== 0) {
            return { success: false, error: `平台 API 错误: code=${viewJson.code}` };
        }

        const { aid, pages } = viewJson.data || {};
        let targetPage = pages?.find((p: any) => p.page === pageIndex);
        if (!targetPage && pages?.length === 1) targetPage = pages[0];
        if (!targetPage) {
            return { success: false, error: `未找到第 ${pageIndex} P` };
        }
        const cid = targetPage.cid;

        // Step 2: Get playurl with DASH format (fnval=16)
        await acquireRequestSlot();
        // fnval=16 = DASH format, fnval=80 = DASH+HDR, qn=127 = 8K (will fallback to best available)
        const playurlApi = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&qn=80&fourk=1`;
        console.log(`[媒体下载] 请求播放地址: bvid=${bvid}, cid=${cid}`);

        const playRes = await fetch(playurlApi, { headers });
        const playJson = await playRes.json();

        if (playJson.code !== 0) {
            return { success: false, error: `playurl API 错误: code=${playJson.code}, ${playJson.message}` };
        }

        const dash = playJson.data?.dash;
        if (!dash) {
            return { success: false, error: 'playurl 未返回 DASH 数据，该视频可能不支持' };
        }

        const result: MediaResult = { success: true };

        // Download helper: fetch a stream URL and save to file
        const downloadStream = async (streamUrl: string, savePath: string, label: string) => {
            console.log(`[媒体下载] 正在下载${label}: ${streamUrl.substring(0, 80)}...`);
            const res = await fetch(streamUrl, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Referer': 'https://www.bilibili.com/',
                    'Origin': 'https://www.bilibili.com',
                }
            });
            if (!res.ok || !res.body) {
                throw new Error(`下载${label}失败: HTTP ${res.status}`);
            }
            // @ts-ignore - Node.js fetch body is a ReadableStream
            const nodeStream = res.body as any;
            const fileStream = createWriteStream(savePath);
            // Use pipeline for proper backpressure handling
            await pipeline(nodeStream, fileStream);
            console.log(`[媒体下载] ✅ ${label}下载完成: ${savePath}`);
        };

        // Download audio
        if (options.audio && dash.audio && dash.audio.length > 0) {
            // Pick best quality audio
            const bestAudio = dash.audio.sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
            const audioUrl = bestAudio.baseUrl || bestAudio.base_url;
            const audioPath = `${outputDir}/${baseName}_audio.m4a`;
            await downloadStream(audioUrl, audioPath, '音频');
            result.audioPath = audioPath;
        }

        // Download video
        if (options.video && dash.video && dash.video.length > 0) {
            // Pick best quality video (prefer codecid 7=AVC/H.264 for compatibility)
            const avcVideos = dash.video.filter((v: any) => v.codecid === 7);
            const videoPool = avcVideos.length > 0 ? avcVideos : dash.video;
            const bestVideo = videoPool.sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
            const videoUrl = bestVideo.baseUrl || bestVideo.base_url;
            const videoPath = `${outputDir}/${baseName}_video.m4v`;
            await downloadStream(videoUrl, videoPath, '视频');
            result.videoPath = videoPath;
        }

        return result;

    } catch (err: any) {
        console.error(`[媒体下载] 异常:`, err.message);
        return { success: false, error: `媒体下载异常: ${err.message}` };
    }
}
