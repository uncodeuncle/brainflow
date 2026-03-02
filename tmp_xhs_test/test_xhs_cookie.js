const https = require('https');

// ==========================================
// 🔴 请把您复制的完整 Cookie 粘贴在下面两个引号中间
// ==========================================
const MY_XHS_COOKIE = "abRequestId=c1597ba6-f57a-51fa-ba5d-816acab8a4a0; a1=19a73a2f09eyo11sigavd1s9u7r54nn2wcm75sqfd50000248369; webId=824b0fb991b184ac1e1757154a9119a2; gid=yj0Wq0q8j0ESyj0Wq0Ji8SMAjdvlyyM3k0hf6ifyMj7WFW2824IIJ2888J4YqKj8JKi4fS24; xsecappid=xhs-pc-web; webBuild=5.13.0; web_session=040069b8671fa191478eab9a963b4b75c581ec; id_token=VjEAAB9I5Y2/IjQjzTzlqRtB35pCo2hgFX6pL5Vg+Rzwe/3S51kzlEw3yD2yS1JvhHvbkRJ++sRGTp9YE9/w5QNz2t8Upi77rNoLHPkEkPAtLrF4sPb9iQWPOPmM0FiJ8yLk5T4V; websectiga=59d3ef1e60c4aa37a7df3c23467bd46d7f1da0b1918cf335ee7f2e9e52ac04cf; sec_poison_id=0c8f17a2-84a7-4dc2-b7bc-be982682cdc8; acw_tc=0a00db0d17723521535608937e4e1f03e624965ed55f3bb58697148dbdaddd; loadts=1772352167068; unread={%22ub%22:%2269a17259000000002801d280%22%2C%22ue%22:%2269a2db78000000001a02b2e8%22%2C%22uc%22:29}";

const url = "https://www.xiaohongshu.com/explore/65e9dc4d0000000007018c1b";

if (!MY_XHS_COOKIE) {
    console.error("❌ 错误：请先在脚本代码里填入您的 Cookie！");
    process.exit(1);
}

console.log(`\n🚀 使用站长专用 Cookie 开始强行提取小红书视频...`);
console.log(`目标链接: ${url}\n`);

const options = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Cookie': MY_XHS_COOKIE,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
    }
};

https.get(url, options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log(`📡 小红书服务器响应状态码: ${res.statusCode}`);

        if (res.statusCode !== 200) {
            console.error("❌ Cookie 可能无效，或者被风控拦截了！这通常是因为拿到的 Cookie 不全或已过期。");
            return;
        }

        // 尝试在返回的网页源码里挖掘视频直链 (提取 __INITIAL_STATE__)
        const match = data.match(/window\.__INITIAL_STATE__=(.+?)<\/script>/);

        if (match && match[1]) {
            try {
                // 清理多余字符并转为 JSON
                const jsonStr = match[1].replace(/undefined/g, 'null');
                const state = JSON.parse(jsonStr);

                const noteData = state?.note?.noteDetailMap;
                if (noteData) {
                    const noteId = Object.keys(noteData)[0];
                    const note = noteData[noteId]?.note;

                    console.log(`\n✅ 【解析成功】拿到核心数据！`);
                    console.log(`📌 标题: ${note?.title || '无'}`);
                    console.log(`📝 描述: ${(note?.desc || '').substring(0, 50)}...`);

                    // 找视频的高清直链 (masterUrl)
                    const videoUrl = note?.video?.media?.stream?.h264?.[0]?.masterUrl;
                    if (videoUrl) {
                        console.log(`\n🔥 BINGO！完美挖到纯净无水印视频播放神链！`);
                        console.log(`▶️ 复制这行链接去浏览器就能直接看：\n${videoUrl}\n`);
                    } else {
                        console.log(`\n⚠️ 这篇笔记找到了，但它是一篇纯图文笔记，没有视频。`);
                    }
                } else {
                    console.log("❌ 没有在 JSON 里找到笔记详情，可能 Cookie 权重极低只进入了首页。");
                }

            } catch (e) {
                console.error("❌ 解析小红书的高级 JSON 时出错:", e.message);
            }
        } else {
            console.log("❌ 网页里没找到关键数据包裹，请检查是否被弹出了滑动验证码。");
        }
    });

}).on('error', (err) => {
    console.error("请求发送失败: " + err.message);
});
