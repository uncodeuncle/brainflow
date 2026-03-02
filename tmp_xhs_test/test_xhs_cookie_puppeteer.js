const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const MY_XHS_COOKIE = "abRequestId=c1597ba6-f57a-51fa-ba5d-816acab8a4a0; a1=19a73a2f09eyo11sigavd1s9u7r54nn2wcm75sqfd50000248369; webId=824b0fb991b184ac1e1757154a9119a2; gid=yj0Wq0q8j0ESyj0Wq0Ji8SMAjdvlyyM3k0hf6ifyMj7WFW2824IIJ2888J4YqKj8JKi4fS24; xsecappid=xhs-pc-web; webBuild=5.13.0; web_session=040069b8671fa191478eab9a963b4b75c581ec; id_token=VjEAAB9I5Y2/IjQjzTzlqRtB35pCo2hgFX6pL5Vg+Rzwe/3S51kzlEw3yD2yS1JvhHvbkRJ++sRGTp9YE9/w5QNz2t8Upi77rNoLHPkEkPAtLrF4sPb9iQWPOPmM0FiJ8yLk5T4V; acw_tc=0a0b11f317723521662644119edd6c844bd6d4062cb78a5eae1cb77b914df9; loadts=1772352181427; unread={%22ub%22:%2269a1b01d000000002202ea63%22%2C%22ue%22:%2269a2bc61000000001d024c24%22%2C%22uc%22:27}; websectiga=634d3ad75ffb42a2ade2c5e1705a73c845837578aeb31ba0e442d75c648da36a; sec_poison_id=2ac349b2-f531-42b0-ae3e-a00871f0d9cc";

async function testXiaohongshu() {
    const url = "https://www.xiaohongshu.com/explore/65e9dc4d0000000007018c1b";
    console.log(`Starting Puppeteer + Cookie test for: ${url}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Convert raw cookie string into array of cookie objects for Puppeteer
    const cookieObjs = MY_XHS_COOKIE.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return {
            name,
            value: rest.join('='),
            domain: '.xiaohongshu.com',
            path: '/'
        };
    }).filter(c => c.name);

    await page.setCookie(...cookieObjs);

    try {
        console.log('Navigating to page with injected cookies...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        console.log(`Current URL after load: ${page.url()}`);

        const initialStateStr = await page.evaluate(() => {
            return window.__INITIAL_STATE__ ? JSON.stringify(window.__INITIAL_STATE__) : null;
        });

        if (initialStateStr) {
            const state = JSON.parse(initialStateStr);
            const noteData = state?.note?.noteDetailMap;
            if (noteData) {
                const noteId = Object.keys(noteData)[0];
                const note = noteData[noteId]?.note;
                console.log(`\n✅ 【解析成功】拿到核心数据！`);
                console.log(`📌 标题: ${note?.title}`);
                const videoUrl = note?.video?.media?.stream?.h264?.[0]?.masterUrl;
                if (videoUrl) {
                    console.log(`🔥 BINGO! Found Video URL inside INITIAL_STATE!`);
                    console.log(`URL: ${videoUrl}\n`);
                } else {
                    console.log('⚠️ Video URL not found in note data (possibly pure image post).');
                }
            } else {
                console.log('❌ No noteDetailMap found (probably redirected to homepage). Cookie might be invalid.');
            }
        } else {
            console.log(`❌ No INITIAL_STATE found.`);
        }

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        await page.screenshot({ path: 'xhs_cookie_puppeteer_result.png', fullPage: true });
        console.log('Saved screenshot to xhs_cookie_puppeteer_result.png');
        await browser.close();
    }
}

testXiaohongshu();
