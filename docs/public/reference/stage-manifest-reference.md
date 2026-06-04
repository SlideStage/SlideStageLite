# `.stage` Manifest 参考

`.stage` 是 SlideStage 的演示包格式。它是一个 zip 文件，根目录必须包含 `manifest.json`，并包含 slide HTML、资源、缩略图和可选的离线镜像信息。

权威 schema 由 `@slidestage/spec` 定义。Lite、Pro 和 Pack 都应以它为单一事实来源。

## 最小合法 Manifest

```json
{
  "schema": "slidestage@1.0",
  "id": "my-deck",
  "version": "1.0.0",
  "title": "My Deck",
  "subtitle": null,
  "author": null,
  "description": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "architecture": "multi-file",
  "dimensions": {
    "width": 1920,
    "height": 1080
  },
  "totalSlides": 1,
  "slides": [
    {
      "index": 1,
      "id": "cover",
      "label": "Cover",
      "file": "slides/01-cover.html",
      "thumbnail": null,
      "notes": null
    }
  ]
}
```

## 必填字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schema` | string | 必须是 `slidestage@1.0`。 |
| `id` | string | deck 标识，1 到 128 个字符；不能包含 `/`、`\`、`..`、NUL 或控制字符。 |
| `version` | string | deck 版本，建议使用 semver，但不是强制。 |
| `title` | string | deck 标题。 |
| `subtitle` | string 或 null | 副标题，可为空。 |
| `author` | string 或 null | 作者，可为空。 |
| `description` | string 或 null | 描述，可为空。 |
| `createdAt` | string | 创建时间，建议 ISO 8601；可作为稳定 zip mtime。 |
| `updatedAt` | string | 更新时间，建议 ISO 8601。 |
| `architecture` | enum | 见下方 architecture 值。 |
| `dimensions.width` | number | 逻辑舞台宽度，必须为正数。 |
| `dimensions.height` | number | 逻辑舞台高度，必须为正数。 |
| `totalSlides` | integer | slide 数量，最大 500；与 `slides.length` 不一致时会被归一化。 |
| `slides[]` | array | 非空 slide 列表，最大 500。 |

## `slides[]` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `index` | integer | 从 1 开始。若不是顺序值，解析器会按数组顺序重编号。 |
| `id` | string | slide 标识。 |
| `label` | string | slide 在 UI 中显示的标题。 |
| `file` | string | 指向包内 HTML 文件的相对路径。必须通过路径安全检查。 |
| `thumbnail` | string 或 null | 可选缩略图路径。 |
| `notes` | string 或 null | 可选 speaker notes，长度上限为 `MAX_NOTES_CHARS`。 |
| `duration` | number | 可选，建议表示秒数。 |
| `transition` | string | 可选，producer 自定义转场提示。 |

## Architecture 值

| 值 | 含义 |
| --- | --- |
| `multi-file` | 每张 slide 一个 HTML 文件，通常位于 `slides/`。 |
| `multi-file-flat` | 每张 slide 一个 HTML 文件，但不要求位于 `slides/`。 |
| `single-file-deckstage` | producer 从单个 `<deck-stage>` 形态生成多张 slide。 |
| `single-file-html` | 一个 HTML 文件渲染整个 deck，常见于 wrap 模式。 |

原始来源框架不应写进 `architecture`。它属于 `provenance.sourceKind`，例如 `reveal`、`impress`、`inline-deck`、`router-html` 或 `plain-html`。

## 常用可选字段

| 字段 | 说明 |
| --- | --- |
| `compat.requires` | deck 需要的运行能力，例如 `same-origin-storage`、`broadcast-channel`、`window-open`。 |
| `compat.notes` | 给用户看的信任提示说明。 |
| `provenance` | 记录来源框架、转换模式、转换器名称和版本。 |
| `offline` | mirror pass 结果，用于说明外部资源是否已折入包内。 |
| `assets` | producer 自定义资源清单。 |
| `runtime` | producer 提供给播放器的提示。 |
| `platform` | 兼容性 gate，例如最低 schema 版本。 |
| `tokens` | producer 自定义设计 token。 |

Manifest schema 是 passthrough 的：未知字段会被保留，但运行时可以忽略它们。不要依赖未知字段在所有工具链中 round-trip。

## Trust 能力

| 能力 | sandbox 变化 | 用途 |
| --- | --- | --- |
| `same-origin-storage` | 加入 `allow-same-origin` | 允许 cookie、localStorage、IndexedDB 等同源存储能力。 |
| `broadcast-channel` | 加入 `allow-same-origin` | 允许 deck 内使用 BroadcastChannel。 |
| `window-open` | 加入 `allow-popups` 和 `allow-popups-to-escape-sandbox` | 允许从 slide 打开新窗口或标签页。 |

基础 sandbox 永远包含 `allow-scripts`。能力授权按 deck 指纹保存。

## 路径安全

所有包内路径都必须：

- 使用 `/` 作为分隔符。
- 相对包根目录。
- 不以 `/` 开头。
- 不包含 `..` 段。
- 不包含 NUL 或控制字符。
- 指向普通文件。

路径违规应以 `E_PATH_TRAVERSAL` 拒绝。

## 指纹规则

SlideStage 使用 `.stage` zip bytes 的 SHA-256 作为 deck 身份，而不是 `manifest.id` 或 `manifest.version`。

因此，打包器如果希望相同输入得到稳定指纹，需要：

- 固定每个 zip entry 的 mtime。
- 固定 zip 全局 mtime。
- 按路径排序 entries。
- 避免在 `manifest.json` 之外写入时间戳类字段。

运行时的批注、备注、信任授权、上次播放位置等都以这个指纹为 key。

## 权威来源

本页是常用参考。完整字段、错误码、大小限制、fixtures 和版本规则以 `packages/spec/README.md` 以及 `@slidestage/spec` 导出的 schema 为准。
