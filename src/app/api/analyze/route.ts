import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export async function POST(req: Request) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    try {
        let { url, sessdata } = await req.json();
        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400, headers: corsHeaders });
        }
        // Normalize: add https:// if protocol is missing (e.g. mobile share links)
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

        // ======= space.bilibili.com Collection/Series URL Handler =======
        // Handles URLs like: https://space.bilibili.com/21869937/lists/2721318?type=series
        //                     https://space.bilibili.com/490978759?spm_id_from=333.1007.tianma.2-1-4.click
        const spaceMatch = url.match(/space\.bilibili\.com\/(\d+)(?:\/lists\/(\d+))?/);
        if (spaceMatch) {
            const mid = spaceMatch[1]; // User ID
            const listId = spaceMatch[2]; // Series/Collection ID (optional)
            const headerObj: any = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://www.bilibili.com/'
            };
            if (sessdata) headerObj['Cookie'] = `SESSDATA=${sessdata}`;

            try {
                if (listId) {
                    // Try as "series" first (type=series)
                    const seriesUrl = `https://api.bilibili.com/x/series/archives?mid=${mid}&series_id=${listId}&only_normal=true&sort=desc&pn=1&ps=100`;
                    const seriesRes = await fetch(seriesUrl, { headers: headerObj });
                    const seriesData = await seriesRes.json();

                    if (seriesData.code === 0 && seriesData.data?.archives?.length > 0) {
                        // Get series meta for title
                        const metaUrl = `https://api.bilibili.com/x/series/series?series_id=${listId}`;
                        const metaRes = await fetch(metaUrl, { headers: headerObj });
                        const metaData = await metaRes.json();
                        const seriesTitle = metaData.data?.meta?.name || `合集 ${listId}`;

                        const archives = seriesData.data.archives;
                        let uploaderName = archives[0]?.owner?.name;

                        // Fallback: If author name is missing, fetch from Bilibili card API
                        if (!uploaderName) {
                            try {
                                const cardRes = await fetch(`https://api.bilibili.com/x/web-interface/card?mid=${mid}`, { headers: headerObj });
                                const cardData = await cardRes.json();
                                if (cardData.code === 0 && cardData.data?.card?.name) {
                                    uploaderName = cardData.data.card.name;
                                }
                            } catch (e) {
                                console.warn('Failed to fetch uploader info fallback', e);
                            }
                        }

                        return NextResponse.json({
                            isPlaylist: true,
                            id: listId,
                            title: seriesTitle,
                            uploader: uploaderName || `UP主 ${mid}`,
                            thumbnail: (archives[0]?.pic || '').replace('http://', 'https://'),
                            entries: archives.map((ep: any, index: number) => ({
                                id: ep.bvid,
                                title: ep.title,
                                duration: ep.duration || 0,
                                index: index + 1,
                                url: `https://www.bilibili.com/video/${ep.bvid}/`
                            }))
                        }, { headers: corsHeaders });
                    }

                    // If series API didn't work, try as "season" (合集 type=season)
                    const seasonUrl = `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=${mid}&season_id=${listId}&sort_reverse=false&page_num=1&page_size=100`;
                    const seasonRes = await fetch(seasonUrl, { headers: headerObj });
                    const seasonData = await seasonRes.json();

                    if (seasonData.code === 0 && seasonData.data?.archives?.length > 0) {
                        const archives = seasonData.data.archives;
                        let uploaderName = archives[0]?.owner?.name;

                        // Fallback: If author name is missing, fetch from Bilibili card API
                        if (!uploaderName) {
                            try {
                                const cardRes = await fetch(`https://api.bilibili.com/x/web-interface/card?mid=${mid}`, { headers: headerObj });
                                const cardData = await cardRes.json();
                                if (cardData.code === 0 && cardData.data?.card?.name) {
                                    uploaderName = cardData.data.card.name;
                                }
                            } catch (e) {
                                console.warn('Failed to fetch uploader info fallback', e);
                            }
                        }

                        return NextResponse.json({
                            isPlaylist: true,
                            id: listId,
                            title: seasonData.data.meta?.name || `合集 ${listId}`,
                            uploader: uploaderName || `UP主 ${mid}`,
                            thumbnail: (seasonData.data.meta?.cover || archives[0]?.pic || '').replace('http://', 'https://'),
                            entries: archives.map((ep: any, index: number) => ({
                                id: ep.bvid,
                                title: ep.title,
                                duration: ep.duration || 0,
                                index: index + 1,
                                url: `https://www.bilibili.com/video/${ep.bvid}/`
                            }))
                        }, { headers: corsHeaders });
                    }
                }

                // No listId or APIs failed — redirect user
                return NextResponse.json({
                    error: '无法解析该 space 页面',
                    details: `space.bilibili.com 链接需要指向具体的合集/系列页面 (如 space.bilibili.com/xxx/lists/yyy)。\n请打开该 UP 主的主页，找到具体的合集或系列链接后重试。`
                }, { status: 400, headers: corsHeaders });
            } catch (e: any) {
                console.warn("Space URL native API failed:", e.message);
                return NextResponse.json({
                    error: '解析 space.bilibili.com 链接失败',
                    details: e.message
                }, { status: 500, headers: corsHeaders });
            }
        }
        // =============================================================

        // ======= Native Bilibili Playlist/UGC Season Extractor =======
        const bvidMatch = url.match(/BV[a-zA-Z0-9]+/);
        if (bvidMatch) {
            const bvid = bvidMatch[0];
            const checkUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
            const headerObj: any = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            };
            if (sessdata) headerObj['Cookie'] = `SESSDATA=${sessdata}`;

            try {
                const biliRes = await fetch(checkUrl, { headers: headerObj });
                const biliData = await biliRes.json();

                if (biliData.code === 0) {
                    const pic = biliData.data.pic;
                    const bvidStr = biliData.data.bvid;
                    const uploader = biliData.data.owner?.name;
                    const title = biliData.data.title;

                    if (biliData.data.ugc_season) { // It's an UGC Season (playlist of different BVs)
                        const season = biliData.data.ugc_season;
                        let allEpisodes: any[] = [];
                        for (const section of (season.sections || [])) {
                            if (section.episodes) allEpisodes = allEpisodes.concat(section.episodes);
                        }

                        if (allEpisodes.length > 0) {
                            return NextResponse.json({
                                isPlaylist: true,
                                id: season.id.toString(),
                                title: season.title,
                                uploader,
                                thumbnail: (season.cover || pic).replace('http://', 'https://'), // Pre-handle http -> https for better proxying/loading
                                entries: allEpisodes.map((ep: any, index: number) => ({
                                    id: ep.bvid,
                                    title: ep.title,
                                    duration: ep.page?.duration || 0,
                                    index: index + 1,
                                    url: `https://www.bilibili.com/video/${ep.bvid}/`
                                }))
                            }, { headers: corsHeaders });
                        }
                    } else if (biliData.data.pages && biliData.data.pages.length > 1) { // It's a Multi-P Video
                        return NextResponse.json({
                            isPlaylist: true,
                            id: bvidStr,
                            title,
                            uploader,
                            thumbnail: pic.replace('http://', 'https://'),
                            entries: biliData.data.pages.map((p: any) => ({
                                id: bvidStr,
                                title: p.part || `P${p.page}`,
                                duration: p.duration,
                                index: p.page,
                                url: `https://www.bilibili.com/video/${bvidStr}/?p=${p.page}`
                            }))
                        }, { headers: corsHeaders });
                    } else {
                        // Single video (only 1 page)
                        const singlePage = biliData.data.pages?.[0];
                        return NextResponse.json({
                            isPlaylist: false,
                            id: bvidStr,
                            title,
                            uploader,
                            thumbnail: pic.replace('http://', 'https://'),
                            entries: [{
                                id: bvidStr,
                                title: singlePage?.part || title,
                                duration: singlePage?.duration || biliData.data.duration || 0,
                                index: 1,
                            }]
                        }, { headers: corsHeaders });
                    }
                }
            } catch (e) {
                console.warn("Bilibili Native view API bypass failed, falling back to yt-dlp", e);
            }
        }
        // =============================================================

        // Cross-platform yt-dlp path: use local binary on Windows, system-installed on Linux
        const isWin = process.platform === 'win32';
        const ytdlpPath = isWin
            ? path.resolve(process.cwd(), 'bin', 'yt-dlp.exe')
            : 'yt-dlp';

        console.log(`Analyzing: ${url} using yt-dlp path: ${ytdlpPath}`);
        if (isWin && !fs.existsSync(ytdlpPath)) {
            throw new Error(`YT-DLP not found at ${ytdlpPath}. Please run the setup script.`);
        }

        // Construct command with Bilibili anti-crawler bypass headers
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
        // Pass SESSDATA via Netscape cookie file (not --add-header) to avoid 412
        let cookieArg = '';
        if (sessdata) {
            const tmpDir = path.join(process.cwd(), 'downloads');
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const cookieFilePath = path.join(tmpDir, `analyze_cookies_${Date.now()}.txt`);
            const decodedSessdata = decodeURIComponent(sessdata);
            const cookieContent = `# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\t${decodedSessdata}\n`;
            fs.writeFileSync(cookieFilePath, cookieContent);
            cookieArg = `--cookies "${cookieFilePath}"`;
        }

        let command = `"${ytdlpPath}" --dump-json --no-warnings --no-check-certificates --user-agent "${userAgent}" ${cookieArg} --extractor-args "bilibili:player_client=web" "${url}"`;

        // Increase maxBuffer for massive Bilibili playlist JSONs (50MB)
        const { stdout, stderr } = await execAsync(command, { maxBuffer: 1024 * 1024 * 50 });

        if (stderr && stderr.trim().length > 0) {
            console.warn("YT-DLP Warning:", stderr);
        }

        // Output might contain multiple JSON objects separated by newlines if it's a playlist
        const lines = stdout.trim().split('\n');

        let data: any; // Renamed from 'output' to 'data' to match original code's subsequent usage
        if (lines.length === 1) {
            data = JSON.parse(lines[0]);
        } else {
            // It's a playlist, parse each line as a video object
            data = {
                _type: 'playlist',
                entries: lines.map((line: string) => JSON.parse(line))
            };
        }

        // Normalize response for the frontend
        const result = {
            isPlaylist: data._type === 'playlist',
            id: data.id || data.entries?.[0]?.id,
            title: data.title || data.entries?.[0]?.playlist || data.entries?.[0]?.title || "未命名内容",
            uploader: data.uploader || data.channel || data.creator || data.entries?.[0]?.uploader || data.entries?.[0]?.channel || data.entries?.[0]?.creator || data.uploader_id || "佚名",
            thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || data.entries?.[0]?.thumbnail || data.entries?.[0]?.thumbnails?.[0]?.url,
            entries: [] as any[],
        };

        if (result.isPlaylist && data.entries) {
            // It's a collection or playlist
            result.entries = data.entries.map((entry: any, index: number) => ({
                id: entry.id,
                title: entry.title,
                duration: entry.duration,
                index: index + 1,
            }));
        } else {
            // Single video
            result.entries = [{
                id: data.id,
                title: data.title,
                duration: data.duration,
                index: 1,
            }];
        }

        return NextResponse.json(result, { headers: corsHeaders });
    } catch (error: any) {
        console.error("Analyze Error Details:", error);
        let errorMessage = error.message || String(error);
        if (error.stderr) {
            errorMessage += ' | STDERR: ' + error.stderr;
            console.error("YT-DLP STDERR:", error.stderr);
        }

        // Return full stack trace or message to client to debug
        return NextResponse.json(
            {
                error: 'Failed to analyze URL',
                details: errorMessage,
                stack: error.stack,
                raw: String(error)
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
