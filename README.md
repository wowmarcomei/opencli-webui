# OpenCLI WebUI

基于 [opencli](https://github.com/jackwener/opencli) 的网页版命令工具，无需终端，打开浏览器即可使用 50+ 平台的数据抓取能力。

支持平台包括：哔哩哔哩、Twitter、知乎、小红书、Reddit、GitHub、YouTube 等。

## 截图

![哔哩哔哩](img/bilibili.png)

![小红书](img/xhs.png)

## 功能

- **命令浏览**：按平台分类展示所有可用命令，支持搜索
- **在线执行**：填写参数后直接在页面执行命令，实时流式输出结果
- **多格式导出**：支持表格、JSON、YAML、CSV、Markdown 格式查看与下载
- **版本管理**：检测 Node.js、opencli CLI 版本，支持一键安装/更新
- **诊断面板**：运行 `opencli doctor` 实时展示环境诊断结果
- **浏览器扩展**：引导安装 opencli 浏览器扩展以支持需要登录的命令

## 快速开始

确保服务器已安装 [Node.js](https://nodejs.org) v20 及以上版本。

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 生产构建
pnpm build && pnpm start
```

默认运行在 [http://localhost:3002](http://localhost:3002)。

若未安装 opencli，页面会提示并支持一键安装：

```bash
npm install -g @jackwener/opencli
```

## 技术栈

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query
- SSE 实时流式输出

## 相关链接

- [opencli](https://github.com/jackwener/opencli) — 命令行工具本体
- [opencli-webui](https://github.com/xjh1994/opencli-webui) — 本项目
