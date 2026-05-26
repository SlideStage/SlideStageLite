# @slidestage/spec

Authoritative definition of the `.stage` (`slidestage@1.0`) container
format. Single source of truth shared by every SlideStage runtime:

- **`SlideStageLite`** (browser player) — through `@slidestage/core/deck/*` re-exports.
- **`SlideStagePro`** (server + admin UI) — through the same `@slidestage/core` surface (zero direct dep).
- **`slidestage-pack`** (CLI / Agent skill) — opt-in via `--strict-schema`, dynamic `import('@slidestage/spec')`.

Everything in this README is the contract. If Lite / Pro / Pack ever
disagree with it, the disagreement is the bug; the spec is the bug
report's reference.

---

## Install

```bash
npm i @slidestage/spec
# or
pnpm add @slidestage/spec
```

Only runtime dependency: `zod` (peer-free, ESM, side-effect-free,
zero DOM / zero Node-only APIs — works in browsers, Workers, Node,
Deno, and Bun).

## Quick start

```ts
import {
  parseManifest,
  logManifestWarningToConsole,
  SCHEMA_LITERAL,
  SIZE_LIMITS,
  DeckLoadError,
} from '@slidestage/spec';

const manifest = parseManifest(await readManifestJsonSomehow(), {
  onWarning: logManifestWarningToConsole,
});
// → fully typed Manifest, or throws ZodError on structural issues,
//   or throws DeckLoadError('E_UNSUPPORTED_SCHEMA', ...) when
//   platform.minSchemaVersion exceeds what this spec advertises.
```

Sub-path imports (recommended for tree-shaking and explicit deps):

| Subpath | Surface |
| --- | --- |
| `@slidestage/spec` | Aggregate re-export of everything below. |
| `@slidestage/spec/constants` | `SCHEMA_LITERAL`, `SUPPORTED_PLATFORM_SCHEMA_VERSION`, `ARCHITECTURES`, `TRUST_CAPABILITIES`, `BASE_SANDBOX_TOKEN`, `MAX_NOTES_CHARS`, `SIZE_LIMITS`, `DECK_LOAD_ERROR_CODES`. |
| `@slidestage/spec/types` | `Manifest`, `ManifestSlide`, `ManifestProvenance`, `ManifestOffline*` (4 types), `ArchitectureKind`, `TrustCapability`, `DeckLoadError`, `DeckLoadErrorCode`, `SchemaLiteral`. |
| `@slidestage/spec/pathSafety` | `normalizePackagePath`, `assertSafePath` (throws-only alias), `isExternalReference`, `resolvePackageReference`, `splitReferenceSuffix`. |
| `@slidestage/spec/trustCapabilities` | `CAPABILITY_REGISTRY`, `normalizeCapabilities`, `sandboxTokensFor`, `capabilitiesEqual`, `describeCapability`, `sandboxAllowsSameOrigin`, `TrustCapabilityInfo`. |
| `@slidestage/spec/manifestSchema` | `manifestSchema` (the Zod object), `parseManifest`, `logManifestWarningToConsole`, `ManifestWarning`, `ParseManifestOptions`. |

---

## Manifest reference (`slidestage@1.0`)

A `.stage` archive is a ZIP file containing `manifest.json` at the
package root plus the slide HTML files (and optional thumbnails,
assets, fonts, speaker notes, mirrored externals).

### Required fields

| Field | Type | Constraint |
| --- | --- | --- |
| `schema` | string literal | Must equal `slidestage@1.0` (see `SCHEMA_LITERAL`). |
| `id` | string | `1..128` chars, no `\0`, no `/`, no `\`, no `..`, no control chars. |
| `version` | string | `1..64` chars (free-form, semver recommended). |
| `title` | string | `1..256` chars. |
| `subtitle` | `string \| null` | — |
| `author` | `string \| null` | — |
| `description` | `string \| null` | — |
| `createdAt` | string | ISO 8601 recommended. Used as the deck-wide mtime in fingerprint-stable packers. |
| `updatedAt` | string | ISO 8601 recommended. |
| `architecture` | enum | One of `multi-file`, `multi-file-flat`, `single-file-deckstage`, `single-file-html`. See `ARCHITECTURES`. |
| `dimensions.width` | number | Positive finite. |
| `dimensions.height` | number | Positive finite. |
| `totalSlides` | integer | `1..500`. Auto-corrected to `slides.length` if they disagree (warning `totalSlidesMismatch`). |
| `slides[]` | array | Non-empty, `length ≤ 500`. Element shape below. |

`slides[i]`:

| Field | Type | Constraint |
| --- | --- | --- |
| `index` | integer ≥ 1 | Should equal `i + 1`. Auto-renumbered if not sequential (warning `slideIndexRenumbered`). |
| `id` | string | `1..128` chars. |
| `label` | string | `1..256` chars. |
| `file` | string | Package-relative path. Must pass path-safety check (`normalizePackagePath`). |
| `thumbnail` | `string \| null` | Package-relative path or null. |
| `notes` | `string \| null` | Cap `MAX_NOTES_CHARS = 16_384` chars. |
| `duration` | number? | Positive seconds, optional. |
| `transition` | string? | `≤ 64` chars, optional. |

### Optional fields

| Field | Shape | Purpose |
| --- | --- | --- |
| `fonts` | `unknown[]` | Producer-defined font registry. Schema reserved for SlideStage v1.1+. |
| `tokens` | `Record<string, unknown>` | Design tokens / theme variables. |
| `assets` | unknown | Producer-defined asset registry. Common shape: `{ totalSize, count, files: [{path, size, type}] }`. |
| `runtime` | unknown | Hints for the player. Common shape: `{ presenterTools, fallbackEntry, capabilities[] }`. |
| `platform` | `{ minSchemaVersion?, compatibleArchitectures?[] }` | Compat gate. `minSchemaVersion > SUPPORTED_PLATFORM_SCHEMA_VERSION` → `E_UNSUPPORTED_SCHEMA`. |
| `provenance` | `{ sourceKind?, conversionMode?, sourceEntry?, converter?: { name, version? } }` | How the deck was produced. |
| `compat` | `{ requires?: TrustCapability[], notes?: string }` | Capabilities the deck needs. Triggers the trust prompt in player runtimes. |
| `offline` | see below | Mirror-pass audit. |
| `stats` | unknown | Producer-defined accounting (`packedAt`, `packerVersion`, …). |

The schema is a permissive `.passthrough()` object — unknown top-level
or nested fields are preserved in memory and ignored by the validator,
so a deck written by a v1.1 producer still loads in a v1.0-aware
consumer. Producers must never rely on unknown fields surviving a
round-trip through a downstream tool that does not understand them.

### `compat.requires`

| Capability | Adds to iframe sandbox | Used for |
| --- | --- | --- |
| `same-origin-storage` | `allow-same-origin` | Cookies, `localStorage`, `IndexedDB`, sibling-tab state sharing. |
| `broadcast-channel` | `allow-same-origin` | `BroadcastChannel` between tabs (needs same-origin scripting). |
| `window-open` | `allow-popups`, `allow-popups-to-escape-sandbox` | Popups / new tabs from the slide. |

Unknown capability strings are dropped with a `unknownCompatCapability`
warning. The normalized list is deduped and **sorted alphabetically**
so set-equality is byte-stable in trust-grant storage. The base
sandbox always includes `allow-scripts` (`BASE_SANDBOX_TOKEN`).

### `offline` (mirror pass)

| Field | Type | Notes |
| --- | --- | --- |
| `ready` | boolean | True iff every in-scope external reference was mirrored or explicitly skipped. |
| `mirroredAt` | string | ISO 8601 of when the mirror pass completed. |
| `mirrorTool.name` | string | Producer identity; `mirrorTool.version` optional. |
| `policy.includeScripts` | boolean | Whether `<script src>` was in scope. |
| `policy.includeIframes` | boolean | Whether `<iframe src>` was in scope. |
| `policy.maxAssetBytes` | int ≥ 0 | Per-asset cap. |
| `policy.maxTotalBytes` | int ≥ 0 | Pass-total cap. |
| `policy.allowedHosts?[]` | string[] | Allowlist; missing = any host. |
| `policy.blockedHosts?[]` | string[] | Denylist host suffixes. |
| `mirroredAssets[]` | `{originalUrl, path, contentHash, contentType, bytes, fetchedAt, referencedBy[]}` | The audit trail of every mirrored asset. Defaults to `[]`. |
| `skippedUrls[]` | `{url, reason, detail?}` | `reason ∈ {unreachable, blocked-by-policy, too-large, unsupported-scheme, budget-exhausted, manual-skip}`. Defaults to `[]`. |

---

## Architecture values

| Value | Meaning |
| --- | --- |
| `multi-file` | One HTML file per slide under `slides/` (or anywhere — `slides[].file` is the source of truth). |
| `multi-file-flat` | Same as `multi-file` but slide files are not constrained to a `slides/` prefix. |
| `single-file-deckstage` | Producer pre-split a single HTML deck (e.g. `<deck-stage>`) into multiple `slides[].file` entries. |
| `single-file-html` | One HTML file rendering the entire deck (wrap mode). |

`provenance.sourceKind` records the *original* shape (`reveal`,
`impress`, `inline-deck`, `webcomponent-deck`, `router-html`,
`plain-html`, …) and is independent of the post-conversion
`architecture`.

---

## Path safety

`normalizePackagePath(p, fromPath?)` and the throws-only alias
`assertSafePath(p, fromPath?)` enforce the same rule for every path
the runtime touches (`slides[].file`, `slides[].thumbnail`,
`assets.files[].path`, mirrored asset paths, rewritten HTML / CSS
references):

- Uses `/` separators after normalization.
- Relative to package root — must not start with `/`.
- Must not contain a `..` segment.
- Must not contain a NUL byte.
- Must not be empty.
- When `fromPath` is supplied the result is resolved relative to it
  (used by the HTML rewriter for `<img src="../assets/x.png">` etc.).

Violations throw `DeckLoadError('E_PATH_TRAVERSAL', ...)`.

---

## Error codes (`DECK_LOAD_ERROR_CODES`)

Stable, machine-readable codes raised by the spec validators and by
runtime loaders. Producers should never invent new codes outside this
union — adding a code is a SemVer minor for `@slidestage/spec`.

| Code | Raised by | Meaning |
| --- | --- | --- |
| `E_NOT_ZIP` | runtime loader | File is not a readable ZIP archive. |
| `E_NO_MANIFEST` | runtime loader | `manifest.json` missing at package root. |
| `E_BAD_MANIFEST` | spec / loader | `manifest.json` failed JSON parse or Zod validation. |
| `E_UNSUPPORTED_SCHEMA` | spec / loader | `manifest.platform.minSchemaVersion` higher than `SUPPORTED_PLATFORM_SCHEMA_VERSION`. |
| `E_PATH_TRAVERSAL` | spec / loader | A package path escapes the archive root or contains a forbidden character. |
| `E_MISSING_SLIDE` | runtime loader | A `slides[].file` is missing from the ZIP. |
| `E_TOO_LARGE` | spec / loader | A `SIZE_LIMITS` bound was exceeded (pack-time or load-time). |
| `E_NO_ENTRY_FOUND` | converter | Source contains no HTML and no manifest. |
| `E_AMBIGUOUS_PACKAGE` | converter | Multiple plausible roots exist and no `index.html` disambiguates. |
| `E_TRUST_REQUIRED` | runtime loader (reserved) | Headless / scripted handle for `compat.requires` rejection. |
| `E_TRUST_DENIED` | runtime loader | User cancelled the trust prompt for a deck with non-empty `compat.requires`. |
| `E_TRANSPORT_PUBLISH_FAILED` | runtime transport | Browser-specific: failed to publish the deck via the chosen transport. |
| `E_TOO_LARGE_FOR_INLINE` | runtime transport | Browser-specific: deck exceeded inline transport budget. |

---

## Size limits (`SIZE_LIMITS`)

Producers MUST enforce these on the way in; consumers MUST enforce them
on the way out. They protect a browser tab from runaway memory just as
much as they protect a server upload pipeline.

| Field | Value | Scope |
| --- | --- | --- |
| `packMax` | 200 MB | `.stage` zip total. |
| `decompressedTotalMax` | 1 GB | Sum of every decompressed entry. |
| `entryMax` | 100 MB | Single zip entry. |
| `slideHtmlMax` | 5 MB | Single slide HTML. |
| `manifestMax` | 5 MB | `manifest.json` payload. |
| `totalSlidesMax` | 500 | `slides.length`. |
| `annotationStrokesPerSlideMax` | 2 000 | Runtime annotation overlay — per slide. |
| `annotationPointsPerStrokeMax` | 10 000 | Runtime annotation overlay — per stroke. |

Notes-length cap: `MAX_NOTES_CHARS = 16_384` (~16 KB UTF-8). Producers
should trim before writing the manifest; consumers may treat overage as
`E_BAD_MANIFEST`.

---

## Normalization warnings (`ManifestWarning`)

`parseManifest(value, { onWarning })` invokes `onWarning` for **soft**
issues that are auto-fixed without rejecting the manifest. The legacy
default handler `logManifestWarningToConsole` writes each warning to
`console.warn` (if a global `console` is available); `@slidestage/spec`
itself never touches `console` so it stays usable from sandboxed runtimes
that strip it.

| `code` | When | Auto-fix |
| --- | --- | --- |
| `totalSlidesMismatch` | `totalSlides !== slides.length` | `totalSlides := slides.length`. |
| `slideIndexRenumbered` | Any `slides[i].index !== i + 1` | All indices reassigned in array order. |
| `unknownCompatCapability` | `compat.requires` contains a non-registry value | The value is dropped from the normalized list. |

---

## Fingerprint (`sha256(zip bytes)`)

A deck's identity is the SHA-256 of the byte-stream of the `.stage`
zip — not `manifest.id`, not `manifest.version`. This is what the
SlideStage runtimes key per-deck persistence by (annotations, notes,
trust grants, presenter ↔ audience BroadcastChannel namespace, last
position…).

```ts
async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

For a packer to produce a stable fingerprint across re-packs of the
same source bytes, every zip entry **must** use a deterministic mtime
(recommended: `Date.parse(manifest.createdAt)`) and the global zip
mtime must match. Entries must also be sorted by path before encoding.
See `slidestage-pack/scripts/pack_stage.mjs` for the canonical
implementation.

---

## Speaker notes convention

`slides[].notes` is the only "soft" producer-side input; spec validates
its type and length, but the *source-of-truth* for human-authored
notes lives in the deck source. Pack-time producers (`pnpm convert
pack` in Lite, `node pack_stage.mjs` in pack-skill) walk this lookup
ladder per slide, **first non-empty wins**, and stop searching:

1. `speaker-notes/<basename>.md` (zip-root sidecar — huashu-design convention).
2. `notes/<basename>.md` (zip-root sidecar — common alt).
3. `<slide-dir>/<basename>.notes.md` (co-located sidecar — router style).
4. `<aside class="(speaker-)?notes">`, `<template id="(speaker-)?notes">`, `<div class="(speaker-)?notes">` inside the slide HTML (reveal.js style).

`<basename>` is the slide file's basename without extension; for
split-mode slides the basename is the *synthesized* output name (e.g.
`01-cover.html` → `01-cover`).

Resolution rules:

- UTF-8 markdown, CRLF → LF normalized.
- Trimmed before non-empty check.
- Trim to `MAX_NOTES_CHARS = 16_384` chars.
- Inline extraction strips HTML tags and collapses whitespace
  (use sidecar files when markdown layout must survive).

---

## Consumer matrix (post-B3)

| Consumer | How it pulls the spec | Dep declaration |
| --- | --- | --- |
| `@slidestage/core` | Direct dep; `deck/*` modules re-export the spec surface. | `"@slidestage/spec": "workspace:*"` (→ `^0.1.0` once published). |
| `@slidestage/ui` / `@slidestage/lite-preset` | Transitive via `@slidestage/core`. | None. |
| SlideStageLite root app | Transitive via `@slidestage/core`. | None. |
| SlideStagePro `apps/api` / `apps/web` | Transitive via `@slidestage/core` (B2 leaves Pro untouched). | None. |
| `slidestage-pack` skill | Opt-in via `--strict-schema`; dynamic `import('@slidestage/spec')`. | `npm install --no-save` during dev; `^0.1.0` devDep once published. |

---

## Versioning

`@slidestage/spec` is the format SoT; every change is a contract change
for every downstream runtime. Bump strictly:

| Bump | When |
| --- | --- |
| patch | Bug fixes in the Zod schema, path validator, or capability registry that **do not** widen or narrow the accepted manifest set; docs-only tweaks. |
| minor | Adding an optional manifest field, a new capability with new sandbox tokens, a new error code, a new entry in `SIZE_LIMITS`. Existing producers still validate. |
| major | Tightening any validator, removing a capability, breaking the export shape, raising any size limit (forces consumers to re-check their assumptions), or bumping `SCHEMA_LITERAL`. |

---

## Fixtures

The package ships golden fixtures under `fixtures/` so every consumer
(`@slidestage/core`, `slidestage-pack`, Lite SPA, Pro server) can
regression-test against the same canonical inputs. Two flavors:

**Manifest fixtures** — for `parseManifest()` schema regression:

- `fixtures/valid/` — 5 manifests that `parseManifest()` must accept
  (`minimum`, `full` covering every optional field, and one per
  non-default architecture).
- `fixtures/invalid/` — 5 manifests that `parseManifest()` must reject,
  each paired with a sibling `*.meta.json` describing the expected
  failure mode (`expectErrorIncludes`, `rejectsAtSpec`).

**Sources fixtures** — for converter pipeline (sniffer / splitReveal /
splitImpress / splitInlineDeck / splitWebComponent / splitRouter /
wrapSource / singleHtml) regression:

- `fixtures/sources/` — 7 framework signature samples (one minimum-
  complete deck per supported framework):
  `reveal-basic/` (Hakimel reveal.js with `.reveal > .slides > <section>`),
  `impress-basic/` (Bartaz impress.js with `#impress > .step*`),
  `html-ppt-skill/` (inline-deck convention),
  `lewislulu-html-ppt/` (inline-deck real-world signature with
  `<body class="tpl-…">` deck-scoped CSS and inline-script triggered
  `compat.requires`),
  `huashu-deckstage/` (webcomponent `<deck-stage><deck-slide>*`),
  `huashu-router/` (`window.DECK_MANIFEST` + sibling `slides/*.html`),
  and `plain.html` (no deck framing — for the single-mode case).
- Each fixture is a minimum-complete framework signature exercising at
  least one non-trivial converter edge case (nested elements, scoping,
  inline scripts, speaker-note variants, asset path resolution).
- `slidestage-pack/tests/build_fixtures.mjs` consumes this directory
  (copies it into pack's own `tests/fixtures/`) — pack is no longer
  the SoT for "what reveal looks like"; spec is.

The full tables + meta-file schema + "Adding a fixture" workflow live
in [`fixtures/README.md`](./fixtures/README.md). Spec ships everything
in the published tarball via `package.json`'s `files: ["dist",
"fixtures", …]`.

Reading from a consumer (Node):

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const specRoot = dirname(require.resolve('@slidestage/spec/package.json'));

// Manifest fixture
const manifest = JSON.parse(
  readFileSync(join(specRoot, 'fixtures/invalid/wrong-schema-literal.json'), 'utf-8'),
);

// Source fixture (read the full subdirectory yourself; spec doesn't ship a tree walker)
const revealHtml = readFileSync(
  join(specRoot, 'fixtures/sources/reveal-basic/index.html'),
  'utf-8',
);
```

The spec itself never reads files — fixture loading is a consumer-side
concern so the spec stays platform-agnostic (browser, Worker, Deno,
Bun…). Bundlers that need to inline fixtures can statically import the
JSON via `with: { type: 'json' }`; source-tree fixtures are expected
to be consumed by Node-side tests (where `createRequire` works) or by
build-time codegen that flattens them into bundler-friendly modules.

---

## License

UNLICENSED — proprietary. See the [LICENSE](../../LICENSE) file at the
repo root.

---

## 中文摘要

`@slidestage/spec` 是 `.stage`（`slidestage@1.0`）容器格式的**权威定义**。
所有 SlideStage 运行时（Lite 浏览器播放器 / Pro 服务端 + 管理面板 /
`slidestage-pack` CLI 与 Agent skill）都共享同一份这里的 Zod schema /
路径安全 / 能力注册 / 错误码 / size 限额 —— 不会再有三仓 schema 漂移。

### 速查

- **包含**：`manifestSchema`（Zod object）、`parseManifest`、
  `normalizePackagePath`、`CAPABILITY_REGISTRY` /
  `sandboxTokensFor` / `normalizeCapabilities`、`DeckLoadError` +
  全套 error code、8 字段 `SIZE_LIMITS`、`MAX_NOTES_CHARS = 16_384`、
  4 种 `architecture` 枚举、3 种 `compat.requires` 能力词表。
- **零依赖**：仅 runtime dep 是 `zod`；零 DOM / 零 Node-only API；
  浏览器、Web Worker、Node、Deno、Bun 通杀。
- **入口**：`import { parseManifest } from '@slidestage/spec'`，
  子路径 6 个（`/constants` `/types` `/pathSafety`
  `/trustCapabilities` `/manifestSchema`），按需 tree-shake。

### Manifest 必填速览

`schema = "slidestage@1.0"` · `id`（≤128 chars，禁 `/ \ .. NUL` 控制符）·
`version` · `title` · `subtitle/author/description` 可 null ·
`createdAt/updatedAt`（ISO 8601）· `architecture`（4 选 1）·
`dimensions.{width,height}` 正数 · `totalSlides`（≤500，与
`slides.length` 不一致会被 normalize + 触发 `totalSlidesMismatch`
warning）· `slides[]` 非空（每张 `index/id/label/file` 必填，
`thumbnail/notes` 可 null）。

可选：`compat.requires`（3 种能力）/ `provenance`（来源溯源）/
`offline`（镜像审计）/ `assets/runtime/platform/fonts/tokens/stats`
（producer 自定义形态，spec 用 passthrough 接住）。

### Size 限额（全 8 字段）

| 字段 | 上限 |
| --- | --- |
| `packMax` | 200 MB（.stage zip 总大小） |
| `decompressedTotalMax` | 1 GB（解压后所有 entry 总和） |
| `entryMax` | 100 MB（单 entry） |
| `slideHtmlMax` | 5 MB（单张 slide HTML） |
| `manifestMax` | 5 MB（`manifest.json`） |
| `totalSlidesMax` | 500 |
| `annotationStrokesPerSlideMax` | 2 000（runtime annotation） |
| `annotationPointsPerStrokeMax` | 10 000（runtime annotation） |

### 信任能力 → sandbox token 映射

| 能力 | 加入 sandbox | 用途 |
| --- | --- | --- |
| `same-origin-storage` | `allow-same-origin` | cookie / localStorage / IndexedDB / 兄弟标签共享状态 |
| `broadcast-channel` | `allow-same-origin` | 跨标签 BroadcastChannel 通信 |
| `window-open` | `allow-popups` + `allow-popups-to-escape-sandbox` | 弹出新窗口 |

基础 sandbox 永远包含 `allow-scripts`（`BASE_SANDBOX_TOKEN`）。

### 指纹规则

deck 身份 = `sha256(zip bytes)`，不是 `manifest.id`、不是
`manifest.version`。这是 SlideStage 所有 per-deck 持久化（标注、备注、
信任授权、presenter ↔ audience BroadcastChannel namespace、上次位置）
的 key。packer 要拿到稳定指纹，每个 zip entry mtime 必须确定（推荐
`Date.parse(manifest.createdAt)`）+ zip global mtime 同步 + entry 按
path 字典序排列。详见 `slidestage-pack/scripts/pack_stage.mjs`。

### 版本规则

`@slidestage/spec` 是格式 SoT，任何变更都会影响每个下游运行时：

- **patch**：bug fix 不改变接受集；纯文档微调。
- **minor**：加可选字段 / 加能力 / 加错误码 / 加 `SIZE_LIMITS` 字段；旧 producer 仍能通过。
- **major**：收紧任何 validator / 删能力 / 改 export 形状 / 提高 size 上限（要求消费者重审假设）/ 改 `SCHEMA_LITERAL`。

### 三仓消费矩阵

- Lite app → `@slidestage/core/deck/*` re-export → spec
- Pro 服务端 → `@slidestage/core/deck/*` 透传 → spec（B2 完成后 Pro 无需改动）
- pack skill → `--strict-schema` 时 `import('@slidestage/spec')` → spec（默认零依赖路径不变）

---

进一步细节、normalization 规则、speaker notes 约定、offline mirror
schema、fingerprint 实现指南都在上方英文章节里，本中文摘要只覆盖
最常被问到的字段。
