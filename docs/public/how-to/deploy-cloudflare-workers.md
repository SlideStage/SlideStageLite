# 将 SlideStage Lite 部署到 Cloudflare Workers

本指南说明如何把 SlideStage Lite 作为静态资源应用部署到 Cloudflare Workers。

Lite 是纯前端应用。生产部署只需要构建 `dist/`，再通过 Wrangler 发布静态 assets。

## 前提条件

你需要：

- Node.js 20 或更新版本。
- pnpm 10.28 或更新版本。
- Cloudflare 账号。
- 当前目录位于 `SlideStageLite` 仓库根目录。

Wrangler 不需要写入 `dependencies` 或 `devDependencies`，部署脚本会通过 `pnpm dlx wrangler` 按需获取。

## 1. 安装依赖

```bash
pnpm install
```

## 2. 配置可选环境变量

如果需要展示备案信息，复制模板：

```bash
cp .env.example .env
```

可配置：

- `VITE_BEIAN_ICP_TEXT`
- `VITE_BEIAN_ICP_URL`
- `VITE_BEIAN_MPS_TEXT`
- `VITE_BEIAN_MPS_URL`

如果 URL 中包含 `#`，必须加双引号：

```dotenv
VITE_BEIAN_MPS_URL="https://beian.mps.gov.cn/#/query/..."
```

不需要备案信息时可以跳过这一步。

## 3. 本地构建

```bash
pnpm build
```

构建产物位于：

```text
dist/
```

## 4. 本地预览 Cloudflare 行为

```bash
pnpm preview:cloudflare
```

这个命令会先构建，再启动 Wrangler dev。

重点检查：

- `/` 能打开首页。
- SPA 子路由能回退到 `index.html`。
- 真实静态文件，例如 `/stage-sw.js`，仍按文件返回。
- 示例 deck 和转换器入口正常。

## 5. 部署到生产

```bash
pnpm deploy:cloudflare
```

首次运行会提示登录 Cloudflare。按浏览器 OAuth 流程完成授权即可。

CI 环境中应设置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 6. 验证生产站点

部署后检查：

- 首页可以加载。
- 打开 `.stage` 文件不需要后端。
- 转换器可以在浏览器本地工作。
- 控制台没有 asset 404。
- 移动端没有横向滚动。

## 常见问题

### 子路由刷新 404

检查 `wrangler.jsonc` 是否配置了 SPA fallback：

```jsonc
{
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

### Wrangler 命令不可用

不要手动添加 wrangler 依赖。使用项目脚本，它会通过 `pnpm dlx wrangler` 获取。

### 改 `.env` 后线上没变化

Lite 的 Vite env 在构建时写入 bundle。修改 `.env` 后必须重新运行 `pnpm build` 和部署。
