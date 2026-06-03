# give-me-x-video 📹

X (Twitter) 视频下载器。粘贴链接，获取视频，就这么简单。

## 架构

```
浏览器 (GitHub Pages)  →  Cloudflare Worker (免费)  →  X API
```

- **前端**：纯 HTML/CSS/JS，托管在 GitHub Pages
- **后端**：Cloudflare Worker，代理 X API 请求
- **成本**：完全免费

## 快速开始

### 1. 部署 Cloudflare Worker

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler deploy
```

部署后你会得到一个 URL，类似：
`https://give-me-x-video.your-subdomain.workers.dev`

### 2. 配置前端

打开 `web/app.js`，修改第一行的 API 地址：

```javascript
const API_BASE = 'https://give-me-x-video.your-subdomain.workers.dev';
```

或者打开页面后在 Settings 里填入 Worker URL。

### 3. 部署 GitHub Pages

```bash
# 推送到 GitHub 后，在 repo Settings → Pages 中：
# Source: main branch, Folder: /web
```

### 4. 使用

手机或电脑浏览器打开 `https://<username>.github.io/give-me-x-video/`，粘贴 X 链接，点击下载。

## 支持的链接格式

- `https://x.com/user/status/1234567890`
- `https://twitter.com/user/status/1234567890`
- `https://x.com/user/status/1234567890?s=20`
- `https://t.co/xxxxx` (短链接自动解析)

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /api/resolve?url=<tweet_url>` | 解析推文，返回视频信息 |
| `GET /api/proxy?url=<video_url>` | 代理视频流式下载 |

## 技术原理

1. 从 URL 中提取 tweet ID
2. 调用 X 的 Syndication API 获取推文媒体信息（无需认证）
3. 如果失败，降级到 GraphQL API（使用 guest token）
4. 解析返回的 JSON，提取最高画质的 mp4 链接
5. 通过 Worker 代理视频流，支持 Range 请求（手机播放器兼容）

## License

MIT
