const https = require('https');

// ==========================================
// 🔴 在下方填入您在 EEAPI 平台注册后复制的【接口密钥(Token)】
// ==========================================
const MY_EEAPI_TOKEN = "";

// 测试链接（小红书）
const videoUrl = "https://www.xiaohongshu.com/explore/65e9dc4d0000000007018c1b";

if (!MY_EEAPI_TOKEN) {
    console.error("❌ 错误：请先填入您的 EEAPI Token！");
    process.exit(1);
}

console.log(`\n🚀 正在调用 EEAPI 商业去水印接口提取视频...`);

// 组装请求 URL（填入 token 和目标 url）
const requestUrl = `https://api.eeapi.cn/api/video/?url=${encodeURIComponent(videoUrl)}&apikey=${MY_EEAPI_TOKEN}`;

https.get(requestUrl, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);

            if (json.code === 200) {
                console.log(`\n✅ 【解析成功】拿到大厂核心数据！`);
                console.log(`📌 平台: ${json.data.platform}`);
                console.log(`📌 标题: ${json.data.title}`);
                console.log(`👤 作者: ${json.data.author}`);
                if (json.data.video_url) {
                    console.log(`\n🔥 BINGO！无水印纯净视频直链在这里：`);
                    console.log(`▶️ ${json.data.video_url}\n`);
                } else if (json.data.images && json.data.images.length > 0) {
                    console.log(`\n🖼️ 这是一个图文笔记，提取到的无水印图片：`);
                    console.log(json.data.images);
                }
            } else {
                console.log(`❌ 解析失败。平台返回错误信息: ${json.msg}`);
            }

        } catch (e) {
            console.error("❌ 解析 JSON 失败:", e.message);
            console.log("原始返回报文:", data);
        }
    });

}).on('error', (err) => {
    console.error("请求失败: " + err.message);
});
