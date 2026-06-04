# Deploy SlideStage Lite to Cloudflare Workers

SlideStage Lite is a static Vite app. Production deployment builds `dist/` and publishes it as Cloudflare Workers static assets.

## Prerequisites

- Node.js 20 or newer.
- pnpm 10.28 or newer.
- A Cloudflare account.
- The `SlideStageLite` repository root.

Wrangler is fetched on demand with `pnpm dlx`; do not add it as a dependency.

## 1. Install dependencies

```bash
pnpm install
```

## 2. Optional environment config

Copy `.env.example` only if you need beian footer chips:

```bash
cp .env.example .env
```

Quote URLs that contain `#`.

## 3. Build

```bash
pnpm build
```

The output is `dist/`.

## 4. Preview Cloudflare behavior

```bash
pnpm preview:cloudflare
```

Check the landing page, SPA fallback, real static files such as `/stage-sw.js`, and converter entry points.

## 5. Deploy

```bash
pnpm deploy:cloudflare
```

For CI, set:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Troubleshooting

If subroutes refresh to 404, check `wrangler.jsonc` and ensure `not_found_handling` is `single-page-application`.

If `.env` changes do not appear, rebuild and redeploy.
