<div align="center">
  <img src="public/favicon.ico" alt="BrainFlow Logo" width="120" />
  <h1>BrainFlow (脑流阅读器)</h1>
  <p>一个将主流视频平台内容沉浸化、结构化提炼的智能工具。</p>
</div>

## ✨ 核心特性

- **多平台突破**：原生支持 B站 等主流视频网站的内容结构化提取。
- **万物转文字**：内置强大的媒体通道 (基于 `yt-dlp` 及 FFmpeg)，辅以阿里云高级语音识别，智能剥离长视频对白。
- **AI 深度提炼**：接入 DeepSeek 大模型对长文本进行多维理解（P0/P1/P2/P3 总结法）。
- **知识沙盘**：沉浸式的「脑流沙盒」，支持基于节点和高亮句库的关联跳转。
- **开箱即用**：专为小白服务器部署设计的安装向导脚本。

---

## 🚀 极速部署指北

无论您是部署在本地还是云服务器，都能在 3 分钟内跑通！

### 前置要求
- [Node.js](https://nodejs.org/) (推荐 >= 18.0)
- [FFmpeg](https://ffmpeg.org/) (必须安装并配置到系统环境变量 `PATH` 中，用于音视频处理)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) (必须安装并配置到系统环境变量 `PATH` 中，或放置于项目根目录的 `bin/` 文件夹下)

### 1. 下载源码

你可以通过 Git 克隆，或者在网页右上角直接点击 `Code -> Download ZIP`。
\`\`\`bash
git clone https://github.com/uncodeuncle/brainflow.git
cd brainflow
\`\`\`

### 2. 一键配置向导 (推荐)

直接运行我们为您准备好的安装向导，它会**互动式**地帮助您配置所有的 API 密钥和部署根路径，并且顺道帮你把 \`npm install\` 也装好：

\`\`\`bash
node setup.js
\`\`\`

### 3. 构建与启动

运行环境构建：
\`\`\`bash
npm run build
\`\`\`

前台启动（测试用）：
\`\`\`bash
npm start
\`\`\`

如果您是部署在云端服务器，我们推荐使用 PM2 守护进程：
\`\`\`bash
npm install -g pm2
npm run pm2
\`\`\`
服务默认启动于 `http://localhost:3000`。您可以通过 Nginx 代理暴漏给外部域名。

---

## 🛠 高级配置与手动设置

如果刚才的向导配置有误，您可以随时打开根目录的 `.env` 文件手动编辑。以下是核心变量的说明：

| 变量名 | 说明 |
| :--- | :--- |
| `NEXT_PUBLIC_BASE_PATH` | 如果您不打算部署在根域名 (比如部署在 `/tools/brainflow` )，请填写此项 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥，用于进行 AI 的底层逻辑拆解与总结 |
| `ALIYUN_ACCESS_KEY_ID` | 阿里云开发凭证，用来调用「听悟」音频转文字接口 |
| `BILIBILI_SESSION_TOKEN` | (选填) B站扫码死绑。填入 SESSDATA 用于跳过前端扫码环节强制校验 |

---

## 声明

本项目仅供学习研究使用。您有责任合法合规地提取网络平台的内容。请勿用于商业目的或非法用途。

---

**由 无界造物 荣誉出品**
