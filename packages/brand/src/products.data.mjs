// Pure-ESM data file so that this registry is consumable by Node scripts
// without a TypeScript build step (e.g. `tools/render-ecosystem.mjs` runs
// directly against this file). Types and a typed re-export live in
// `./products.ts` — keep the two files in sync; CI's `pnpm typecheck` will
// flag any drift because `products.ts` imports from this file.

/**
 * @typedef {Object} SlideStageProductData
 * @property {string} slug
 * @property {string} name
 * @property {string} tagline
 * @property {string} summary
 * @property {string} summaryZh
 * @property {string} repo
 * @property {'app'|'package'} kind
 * @property {string} markPng
 * @property {string} [npm]
 * @property {string} [homepage]
 */

/** @type {ReadonlyArray<SlideStageProductData>} */
export const SLIDESTAGE_PRODUCTS_DATA = Object.freeze([
  Object.freeze({
    slug: 'slidestage-lite',
    name: 'SlideStage Lite',
    tagline: 'Local-first runtime',
    summary:
      'Open, present, convert `.stage` decks in any browser. Zero backend, zero accounts.',
    summaryZh:
      '在任意浏览器中打开、播放、转换 `.stage` 文件。零后端，零账号。',
    repo: 'https://github.com/SlideStage/SlideStageLite',
    kind: 'app',
    markPng: 'slidestage-mark.png',
    homepage: 'https://slidestage.dev',
  }),
  Object.freeze({
    slug: 'slidestage-pro',
    name: 'SlideStage Pro',
    tagline: 'Self-hosted platform',
    summary:
      'Multi-user `.stage` library with notes, annotations, admin invites and Docker deploy.',
    summaryZh:
      '多用户 `.stage` 协作平台，含笔记、批注、管理员邀请、Docker 部署。',
    repo: 'https://github.com/SlideStage/SlideStagePro',
    kind: 'app',
    markPng: 'slidestage-pro-mark.png',
  }),
  Object.freeze({
    slug: 'slidestage-pack',
    name: 'slidestage-pack',
    tagline: 'Agent skill packer',
    summary:
      'Turn any HTML deck (reveal / impress / html-ppt / huashu / plain) into a portable `.stage` file.',
    summaryZh:
      '把任何 HTML deck (reveal / impress / html-ppt / huashu / 纯 HTML) 打包成可移植的 `.stage`。',
    repo: 'https://github.com/SlideStage/slidestage-pack',
    kind: 'app',
    markPng: 'slidestage-pack-mark.png',
  }),
  Object.freeze({
    slug: 'slidestage-brand',
    name: '@slidestage/brand',
    tagline: 'Brand & design tokens',
    summary:
      'SVG / PNG marks, favicons, social cards and design tokens shared across the family.',
    summaryZh:
      '全产品共享的 SVG / PNG 品牌资产、favicon、social card 与设计 token。',
    repo: 'https://github.com/SlideStage/SlideStageLite/tree/main/packages/brand',
    kind: 'package',
    markPng: 'slidestage-mark.png',
    npm: '@slidestage/brand',
  }),
  Object.freeze({
    slug: 'slidestage-spec',
    name: '@slidestage/spec',
    tagline: '.stage format spec',
    summary:
      'TypeScript types and runtime validators for the `.stage` container schema.',
    summaryZh:
      '`.stage` 容器格式的 TypeScript 类型与运行时校验器。',
    repo: 'https://github.com/SlideStage/SlideStageLite/tree/main/packages/spec',
    kind: 'package',
    markPng: 'slidestage-mark.png',
    npm: '@slidestage/spec',
  }),
]);
