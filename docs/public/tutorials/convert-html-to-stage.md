# 在 SlideStage Lite 中把 HTML 转成 `.stage`

本教程说明如何用 SlideStage Lite 的浏览器转换器，把 HTML deck 转换成 `.stage` 文件。

这个流程适合不想使用 CLI 的用户。转换在浏览器本地完成，不会上传源文件。

## 前提条件

你需要：

- 可打开的 SlideStage Lite。
- 一份 HTML deck 文件、目录或 zip。
- 现代浏览器。目录拖放需要浏览器支持 File System Access 或等价目录读取能力。

## 1. 打开转换器

进入 SlideStage Lite 首页，点击 **Convert from HTML deck** 或同等入口。

你会看到转换面板。它接受：

- 单个 `.html` 文件。
- 包含 `index.html` 的目录。
- 包含 HTML deck 的 `.zip`。
- 已有 `.stage` 文件。

## 2. 选择源文件

把源拖入转换面板，或点击选择文件。

如果你的 deck 有多个 HTML 文件，推荐选择整个目录或 zip，而不是只选择入口 HTML。这样转换器才能复制图片、CSS、字体和脚本等资源。

## 3. 选择转换模式

默认使用 `auto`。转换器会识别源框架并选择合适模式。

常见模式：

- `split`：把每张 slide 拆成一个独立 HTML 文件。
- `wrap`：保留原 deck runtime，把整个 deck 包成一张 slide。
- `single`：把普通 HTML 作为一张 slide。
- `passthrough`：校验并重新输出已有 `.stage`。

建议：

- reveal.js 和 impress.js 通常用 `wrap`，保留 fragments、transition、3D 变换和插件。
- huashu-design、html-ppt-skill 这类结构化 inline deck 通常用 `split`。
- 普通单页 HTML 用 `single`。

## 4. 检查能力提示

如果源 HTML 保留了脚本，转换器会在 manifest 中写入 `compat.requires`。

常见能力包括：

- `same-origin-storage`
- `broadcast-channel`
- `window-open`

这些能力不会在转换时自动授权。播放时，Lite 会按 deck 指纹显示信任提示。

## 5. 可选：生成离线包

如果源 deck 依赖外部图片、字体或 CSS，可以开启离线镜像选项。

离线镜像会尝试把外部资源下载并写入 `.stage`，同时在 manifest 的 `offline` 字段中记录结果。

注意：

- 不可信 deck 不建议开启脚本或 iframe 的离线镜像。
- 私有网络、localhost 和云元数据地址默认应被拦截。
- 过大的资源会被跳过或触发大小限制。

## 6. 下载 `.stage`

点击转换按钮后，Lite 会生成 `.stage` 并触发下载。

下载完成后，建议立刻把它拖回 Lite 打开验收：

- slide 顺序是否正确。
- 资源是否完整。
- notes 是否正确显示。
- 是否出现预期的信任提示。

## 7. 上传或分发

验收通过后，你可以：

- 把 `.stage` 发给别人本地播放。
- 上传到 SlideStage Pro。
- 放进发布产物或归档系统。

## 常见问题

### 目录拖放失败

把目录压成 `.zip` 后再拖入转换器。

### reveal.js 动画丢失

检查是否使用了 `split`。如果 deck 依赖 reveal runtime，改用 `wrap`。

### 播放时提示需要授权

这是预期行为。说明 deck 声明了额外能力。只授权你信任的 deck。
