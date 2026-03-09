<div align="center">
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

## 🚀 极速一键部署指北 (双击启动流)

无论您是纯正的技术小白，还是不想折腾的高端玩家，这套部署系统将让您在 1 分钟内跑通一切！

### 前置要求
- **[Node.js](https://nodejs.org/)** (请前往官网下载稳定版并无脑下一步安装，必须)
- **Redis** — BrainFlow 后台强依赖 Redis 进行任务队列派发（极力推荐零配置的免费云端 [Upstash](https://upstash.com/)，详见下方方案）

*(注：系统需要的 FFmpeg 和 yt-dlp 已经不再需要您手动下载及配置烦人的环境变量，我们的装机向导会自动给您打理好一切！)*

### 第 1 步：下载源码
您可以在网页右上角直接点击 `Code -> Download ZIP`，然后解压到您喜欢的地方。

### 第 2 步：双击安装
进入解压后的文件夹内：
- 🪟 **Windows 用户**: 找到并连按两次 **`install.bat`**。
- 🍎 **Mac / Linux 用户**: 打开终端执行 `bash install.sh`。

向导会被唤醒，它将：
1. **自动帮您下载数万个 NPM 依赖代码**
2. **通过一问一答，贴心帮您配置大模型及阿里云的 API 秘钥**（可以直接回车跳过后续手动在 `.env` 里填）
3. **全自动匹配您的操作系统，下载所需版本的 FFmpeg 与归档工具放到项目中，绝对不弄脏您的电脑系统变量！**

您只需要看着它跑完，显示配置完毕即可。

### 第 3 步：一键发车
安装成功后，日常使用只需要：
- 🪟 **Windows 用户**: 连按两次 **`start.bat`**。
- 🍎 **Mac / Linux 用户**: 执行 `bash start.sh`。

系统会自动同时拉起前端的 Next.js 服务以及躲在幕后的 AI 解析引擎，并在几秒后**自动为您打开默认浏览器**访问 `http://localhost:3000`！

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
