const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const envPath = path.join(__dirname, '.env');

console.log('=================================');
console.log('欢迎使用 BrainFlow (脑流) 部署向导');
console.log('=================================\n');

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function runSetup() {
    let envContent = '';

    if (fs.existsSync(envPath)) {
        console.log('检测到已存在 .env 配置文件。');
        const overwrite = await askQuestion('是否要重新配置？(y/N): ');
        if (overwrite.toLowerCase() !== 'y') {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
    }

    if (!envContent) {
        console.log('\n--- 基础配置 ---');
        const basePath = await askQuestion('当前服务会部署在域名的子目录下吗？如果直接在根目录访问请直接回车跳过。\n例如需部署在 www.test.com/tools/brainflow，请在此输入 /tools/brainflow\n[Base Path]: ');

        console.log('\n--- API Key 配置 (可选，可直接回车跳过后续在 .env 修改) ---');
        const deepseekKey = await askQuestion('DeepSeek API Key (用于 AI 总结): ');
        const aliyunKeyId = await askQuestion('阿里云 AccessKey ID (用于阿里听悟语音转文字): ');
        const aliyunKeySecret = await askQuestion('阿里云 AccessKey Secret: ');
        const tingwuAppKey = await askQuestion('阿里云 听悟 AppKey: ');

        envContent = `NEXT_PUBLIC_BASE_PATH=${basePath || ''}
DEEPSEEK_API_KEY=${deepseekKey || ''}
ALIYUN_ACCESS_KEY_ID=${aliyunKeyId || ''}
ALIYUN_ACCESS_KEY_SECRET=${aliyunKeySecret || ''}
TINGWU_APP_KEY=${tingwuAppKey || ''}

# 高级选项：B站扫码备用登录 SESSDATA
BILIBILI_SESSION_TOKEN=
`;

        fs.writeFileSync(envPath, envContent);
        console.log('\n✅ 配置文件 .env 初始化成功！');
    }

    console.log('\n--- 开始安装依赖代码 ---');
    try {
        console.log('正在执行 npm install...');
        execSync('npm install', { stdio: 'inherit' });

        console.log('\n--- 准备启动服务 ---');
        console.log('正在拉起全自动后台队列与主程序...');
        console.log('=================================');
        console.log('部署完成！您可以运行 `npm start` 开启常规运行。');
        console.log('或者运行 `npm run pm2` 进行常驻后台部署。');

    } catch (error) {
        console.error('❌ 安装依赖时发生错误：', error.message);
        console.log('建议您手动运行 npm install 后再试。');
    }

    rl.close();
}

runSetup();
