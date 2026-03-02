const puppeteer = require('puppeteer');
const fs = require('fs');

async function testXiaohongshu() {
    const url = "https://www.xiaohongshu.com/explore/65e9dc4d0000000007018c1b";
    console.log(`Starting Puppeteer test for: ${url}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    try {
        console.log('Navigating to page...');

        // We only wait for domcontentloaded to avoid the redirect overtaking us
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        const initialStateStr = await page.evaluate(() => {
            return window.__INITIAL_STATE__ ? JSON.stringify(window.__INITIAL_STATE__) : null;
        });

        if (initialStateStr) {
            fs.writeFileSync('xhs_state.json', initialStateStr);
            console.log('Saved FULL __INITIAL_STATE__ to xhs_state.json');

            try {
                const state = JSON.parse(initialStateStr);
                // Try to dig through the state object for the video
                const noteData = state?.note?.noteDetailMap;
                if (noteData) {
                    const noteId = Object.keys(noteData)[0];
                    const note = noteData[noteId]?.note;
                    console.log(`Note Title: ${note?.title}`);
                    console.log(`Note Description: ${note?.desc}`);
                    console.log(`Note Type: ${note?.type}`);

                    const videoUrl = note?.video?.media?.stream?.h264?.[0]?.masterUrl;
                    if (videoUrl) {
                        console.log(`\n🎉 BINGO! Found Video URL inside INITIAL_STATE!`);
                        console.log(`URL: ${videoUrl}\n`);
                    } else {
                        console.log('Video URL not found in the expected path, but let\'s check if it exists anywhere in the JSON string...');
                        if (initialStateStr.includes('.mp4')) {
                            console.log('Found .mp4 mentions in the JSON string! You just need to parse it.');
                        }
                    }
                }
            } catch (e) {
                console.error("Error parsing the JSON state:", e);
            }
        } else {
            console.log(`No INITIAL_STATE found.`);
        }

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

testXiaohongshu();
