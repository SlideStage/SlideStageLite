# 为 `.stage` 生成离线资源包

有些 HTML deck 依赖外部图片、字体、CSS 或媒体。离线 mirror 会把可下载的外部资源折入 `.stage`，让 deck 在无网络环境中尽量保持一致播放。

## 什么时候需要 mirror

使用 mirror，当 deck：

- 引用了 CDN 图片、字体或 CSS。
- 需要在断网会议室播放。
- 要上传到长期归档系统。
- 要交给不能访问公网的团队。

如果 deck 已经只使用本地资源，不需要 mirror。

## 1. 准备 `.stage`

先生成普通 `.stage`：

```bash
pnpm convert pack ./my-deck --out ./my-deck.stage
```

或使用 `slidestage-pack` 生成。

## 2. 运行 mirror

在 `SlideStageLite` 仓库中运行：

```bash
pnpm mirror ./my-deck.stage -o ./my-deck.offline.stage
```

输出文件会写在 `-o` 指定路径。

## 3. 调整资源预算

默认策略会限制单个资源和总下载量。大型 deck 可以按需调整：

```bash
pnpm mirror ./my-deck.stage \
  -o ./my-deck.offline.stage \
  --max-asset-bytes 10485760 \
  --max-total-bytes 209715200
```

建议先压缩源资源，而不是无限提高预算。

## 4. 是否包含脚本和 iframe

默认不建议 mirror 外部脚本和 iframe。只有在来源可信时才开启：

```bash
pnpm mirror ./my-deck.stage \
  -o ./my-deck.offline.stage \
  --include-scripts \
  --include-iframes
```

外部脚本即使被镜像，播放时仍然运行在 deck sandbox 中。不要对不可信来源开启。

## 5. 生成报告

可以输出 Markdown 报告用于审计：

```bash
pnpm mirror ./my-deck.stage \
  -o ./my-deck.offline.stage \
  --report ./mirror-report.md
```

报告应说明：

- 成功镜像的 URL。
- 写入包内的路径。
- 跳过的 URL。
- 跳过原因，例如过大、不可达、被策略阻止。

## 6. 验收离线包

把 `my-deck.offline.stage` 拖入 Lite。

检查：

- 断网后图片和字体仍可显示。
- `offline` badge 或等价提示符合预期。
- speaker notes 和批注不受影响。
- 需要信任能力的 deck 仍会显示授权提示。

## 安全策略

Mirror 默认应拒绝：

- localhost。
- 私有网段。
- link-local 地址。
- 云元数据地址。
- 明显不可下载或超预算资源。

如果确实需要访问私有网络资源，应在隔离网络中运行，并明确记录原因。

## 常见问题

### 离线后仍有资源丢失

检查报告中的 skipped URLs。常见原因是资源过大、服务端拒绝下载、URL 由 JavaScript 动态生成。

### JS 动态加载的资源没有被 mirror

Mirror 主要重写静态 HTML/CSS 引用。JavaScript 字符串、运行时 `fetch()`、动态 `import()` 不保证被发现。

### 输出包太大

压缩图片、裁剪视频，或降低 `--max-total-bytes` 让 mirror 显式跳过过大资源。
