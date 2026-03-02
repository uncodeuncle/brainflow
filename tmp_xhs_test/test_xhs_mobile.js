const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function testXiaohongshu() {
    const url = "https://www.xiaohongshu.com/explore/65e9dc4d0000000007018c1b";
    console.log(`Starting Stealth Mobile Puppeteer test for: ${url}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();

    // Emulate an iPhone 13
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');

    try {
        console.log('Navigating to mobile page...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        console.log(`Current URL: ${page.url()}`);

        await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
        console.error(`Error: ${err.message}`);
    } finally {
        await page.screenshot({ path: 'xhs_mobile_result.png', fullPage: true });
        console.log('Saved screenshot to xhs_mobile_result.png');
        await browser.close();
    }
}

testXiaohongshu();
