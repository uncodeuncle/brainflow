<div align="center">
  <img src="public/favicon.ico" alt="BrainFlow Logo" width="120" />
  <h1>BrainFlow (脑流阅读器)</h1>
  <p>将视频、本地音视频与冗长文档即刻脱水，将知识点榨成脑流。</p>
</div>

## ✨ 核心特性

- **多平台突破**：原生支持 B站 等主流视频网站的内容结构化提取。
- **本地万物转录 (v0.2 新增)**：支持直接拖拽上传本地视音频 (`.mp4`, `.mp3`) 与文档 (`.pdf`, `.docx`, `.txt`)，通过阿里云 OSS STS 前端直传，不耗损服务器带宽。
- **万物转文字**：内置强大的媒体通道 (基于 `yt-dlp` 及 FFmpeg)，辅以阿里云高级语音识别，智能剥离长视频对白。
- **AI 深度提炼**：接入 DeepSeek 大模型对长文本进行多维理解（P0/P1/P2/P3 总结法），自适应提取时间流或纯博文总结。
- **知识沙盘**：沉浸式的「脑流沙盒」，支持基于节点和高亮句库的关联跳转。
- **开箱即用**：专为小白服务器部署设计的安装向导与一键拉起脚本。

---

## 🚀 极速部署指北

无论您是部署在本地还是云服务器，都能在 3 分钟内跑通！

### 前置要求
- [Node.js](https://nodejs.org/) (推荐 >= 18.0)
- [FFmpeg](https://ffmpeg.org/) (必须安装并配置到系统环境变量 `PATH` 中，用于音视频处理)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) (必须安装并配置到系统环境变量 `PATH` 中，或放置于项目根目录的 `bin/` 文件夹下)
- **Redis** — BrainFlow 使用 BullMQ 管理后台任务队列，因此需要 Redis 实例（见下方 Redis 部署方案）

### 1. 下载源码

你可以通过 Git 克隆，或者在网页右上角直接点击 `Code -> Download ZIP`。
\`\`\`bash
git clone https://github.com/uncodeuncle/brainflow.git
cd brainflow
\`\`\`

### 2. 安装依赖 & 配置环境变量

```bash
npm install
cp .env.example .env
```

然后打开 `.env` 文件，按照注释填写您的 API 密钥（见下方[高级配置](#-高级配置与手动设置)章节）。

### 3. 本地开发 (一键双栈启动)

```bash
npm run dev:all
```

这会同时启动 Next.js 前端服务 (`localhost:3000`) 和后台任务 Worker，无需开两个终端。

### 4. 生产部署

运行环境构建：
\`\`\`bash
npm run build
\`\`\`

如果您是部署在云端服务器，我们推荐使用 PM2 守护进程：
\`\`\`bash
npm install -g pm2
npm run pm2
\`\`\`
服务默认启动于 `http://localhost:3000`。您可以通过 Nginx 代理暴露给外部域名。

---

## 🗄️ Redis 部署方案

BrainFlow 使用 BullMQ 管理后台的视频/音频提取任务队列，因此**必须**有一个 Redis 实例可用。根据技术水平，可选以下任意方案：

| 方案 | 适合人群 | 操作 |
| :--- | :--- | :--- |
| **☁️ 云 Serverless Redis (最省事)** | 不想折腾系统环境 | 注册 [Upstash](https://upstash.com/) 免费账号，创建一个 Redis 数据库，将连接 URL 填入 `.env` 的 `REDIS_HOST` + `REDIS_PORT` |
| **🍺 本地原生安装** | 普通用户 | Mac: `brew install redis && brew services start redis`；Windows: 安装 [Memurai](https://www.memurai.com/) 或通过 WSL 安装 |
| **🐳 Docker (进阶)** | 容器环境用户 | `docker run -d -p 6379:6379 redis:alpine` |

---

## 🛠 高级配置与手动设置

您可以复制根目录的 `.env.example` 为 `.env` 来进行手动编辑。以下是核心变量的说明：

| 变量名 | 说明 |
| :--- | :--- |
| `NEXT_PUBLIC_BASE_PATH` | 如果您不打算部署在根域名 (比如部署在 `/tools/brainflow`)，请填写此项，否则留空 |
| `REDIS_HOST` | Redis 服务器地址，默认 `127.0.0.1` |
| `REDIS_PORT` | Redis 端口，默认 `6379` |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥，用于进行 AI 的底层逻辑拆解与总结 |
| `ALIYUN_ACCESS_KEY_ID` | 阿里云 **RAM 子账号** 开发凭证，**严禁使用主账号**，用于调用「听悟」音频转文字与颁发 OSS STS 令牌 |
| `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 RAM 子账号的访问密钥 |
| `ALIYUN_STS_ROLE_ARN` | 用于前端 OSS 直传的 RAM 角色 ARN，格式：`acs:ram::主账号UID:role/角色名` |
| `ALIYUN_OSS_BUCKET` | 用于接收本地文件直传的 OSS Bucket 名称 |
| `ALIYUN_OSS_REGION` | OSS 所在可用区 (例如 `oss-cn-shenzhen`) |
| `TINGWU_APP_KEY` | 阿里云「通义听悟」接口的专属 APP KEY，用于语音识别 |
| `BILIBILI_SESSION_TOKEN` | (选填) B站 SESSDATA，填入后可跳过前端扫码环节 |

### 💡 阿里云 OSS 直传配置指引 (本地文件功能)

要启用「上传本地文件」功能，需要在阿里云控制台完成以下步骤：

1. **创建 RAM 子账号**：前往 [RAM 控制台](https://ram.console.aliyun.com/users) → 创建用户 → 勾选"OpenAPI 调用访问"。该用户需要具有 `AliyunSTSAssumeRoleAccess` 和 `AliyunNLSFullAccess` 权限。
2. **创建 RAM 角色**：前往"角色"页面 → 创建角色 (选"阿里云账号") → 为该角色添加 `AliyunOSSFullAccess` 权限策略。
3. **创建 OSS Bucket**：前往 [OSS 控制台](https://oss.console.aliyun.com/) 创建 Bucket，记下 Bucket 名称和所在地域。确保允许 CORS 跨域请求（允许 `*` 来源）。
4. **填写 `.env`**：将 RAM 子账号的 AccessKey、角色 ARN 和 Bucket 信息填入 `.env` 对应字段。

---

## 声明

本项目仅供学习研究使用。您有责任合法合规地提取网络平台的内容。请勿用于商业目的或非法用途。

---

**由 无界造物 荣誉出品**
