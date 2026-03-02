const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

async function testXiaohongshu() {
    const url = "https://www.xiaohongshu.com/explore/65e9dc4d0000000007018c1b";
    console.log(`Starting Stealth Puppeteer test for: ${url}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        console.log('Navigating to page...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        console.log(`Current URL: ${page.url()}`);

        // Wait a bit to see if video loads
        await new Promise(r => setTimeout(r, 3000));

        const initialStateStr = await page.evaluate(() => {
            return window.__INITIAL_STATE__ ? JSON.stringify(window.__INITIAL_STATE__) : null;
        });

        if (initialStateStr) {
            fs.writeFileSync('xhs_stealth_state.json', initialStateStr);
            console.log('Saved FULL __INITIAL_STATE__ to xhs_stealth_state.json');

            const state = JSON.parse(initialStateStr);
            const noteData = state?.note?.noteDetailMap;
            if (noteData) {
                const noteId = Object.keys(noteData)[0];
                const note = noteData[noteId]?.note;
                console.log(`Note Title: ${note?.title}`);
                const videoUrl = note?.video?.media?.stream?.h264?.[0]?.masterUrl;
                if (videoUrl) {
                    console.log(`\n🎉 BINGO! Found Video URL inside INITIAL_STATE!`);
                    console.log(`URL: ${videoUrl}\n`);
                } else {
                    console.log('Video URL not found in note data.');
                }
            } else {
                console.log('No noteDetailMap found (probably redirected to homepage).');
            }
        } else {
            console.log(`No INITIAL_STATE found.`);
        }

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        await page.screenshot({ path: 'xhs_stealth_result.png', fullPage: true });
        console.log('Saved screenshot to xhs_stealth_result.png');
        await browser.close();
    }
}

testXiaohongshu();
