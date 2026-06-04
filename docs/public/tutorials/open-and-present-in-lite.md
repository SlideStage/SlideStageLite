# 在 SlideStage Lite 中打开并演示 `.stage`

本教程面向第一次使用 SlideStage Lite 的用户。你会打开一份 `.stage` 文件，进入播放界面，并使用基础演讲者工具完成一次本地演示。

## 前提条件

你需要：

- 一份合法的 `.stage` 文件。
- 浏览器版 SlideStage Lite，或已安装的桌面版 SlideStage Lite。

Lite 不需要账号，也不会把 deck 上传到服务器。文件在本地浏览器或桌面应用中读取。

## 1. 打开 `.stage`

进入 SlideStage Lite 首页后，你可以：

- 把 `.stage` 文件拖到页面中央的打开区域。
- 点击打开区域，从文件选择器中选择 `.stage`。
- 使用示例 deck 先体验播放流程。

打开后，Lite 会读取 zip、解析 `manifest.json`、检查 slide 文件和路径安全，然后进入播放界面。

## 2. 处理信任提示

有些 deck 会声明额外能力，例如：

- `same-origin-storage`：需要同源存储能力。
- `broadcast-channel`：需要跨窗口同步能力。
- `window-open`：需要打开新窗口。

Lite 会按 deck 指纹显示信任提示。只有你明确授权后，Lite 才会为该 deck 提升 iframe sandbox 能力。

如果你不信任来源，选择取消。取消后 deck 不会进入播放界面，授权也不会被保存。

## 3. 使用播放界面

进入播放界面后，主要区域是当前 slide。底部工具栏会自动隐藏，移动鼠标或触控屏幕时会出现。

常用操作包括：

- 上一页/下一页：切换 slide。
- 概览：查看所有 slide 缩略图。
- 全屏：进入演示模式。
- 黑屏/白屏：临时遮挡内容。
- 激光笔和聚光：引导观众视线。
- 画笔、荧光笔、橡皮：在 slide 上批注。

批注坐标以 manifest 中的逻辑尺寸为基准保存，因此窗口缩放后仍能对齐。

## 4. 查看 speaker notes

如果 `.stage` 的 `manifest.slides[].notes` 中包含备注，Lite 会在演讲者视图中显示它们。

备注通常由打包器从这些位置抽取：

- `speaker-notes/<basename>.md`
- `notes/<basename>.md`
- `<slide-dir>/<basename>.notes.md`
- slide HTML 中的 `<aside class="notes">`

为了保留 Markdown 排版，推荐在源 deck 中使用 sidecar `.md` 文件，而不是把备注直接写进 HTML。

## 5. 打开观众窗口

如果你需要第二屏输出，可以打开观众窗口。观众窗口会同步：

- 当前 slide。
- 黑屏/白屏状态。
- 激光笔位置。
- 聚光区域。
- 画笔和荧光笔批注。

同步通过浏览器窗口间通信完成，不需要服务器。

## 6. 结束演示

演示结束后，关闭 deck 或返回首页即可。Lite 会按 deck 指纹保存本地状态，例如批注、备注、信任授权和最近打开记录。

如果同一份 `.stage` 被重新打包导致 zip bytes 变化，它会得到新的指纹，Lite 会把它视为另一份 deck。

## 常见问题

### 打开后提示格式错误

这通常表示文件不是 zip、缺少 `manifest.json`，或 manifest 不符合 `slidestage@1.0` schema。请先用 packer 的 verify 命令校验产物。

### reveal.js 或 impress.js deck 播放不完整

如果源 deck 严重依赖原框架运行时，打包时应优先使用 `wrap` 模式，而不是 `split`。

### 离线时资源丢失

如果 slide 依赖外部图片、字体或 CSS，先用 mirror pass 生成离线包，再重新打开 `.stage`。
