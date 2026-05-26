<p align="center">
  <a href="https://slidestage.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="public/brand/png/slidestage-logo-horizontal-on-dark@2x.png">
      <img src="public/brand/png/slidestage-logo-horizontal@2x.png" alt="SlideStage Lite" width="520">
    </picture>
  </a>
</p>

<p align="center">
  <strong>在浏览器里打开、演示、转换 <code>.stage</code> 演示包。</strong><br/>
  零后端 · 零账号 · 零上传。
</p>

<p align="center">
  <a href="https://slidestage.dev"><img alt="官网" src="https://img.shields.io/badge/%E5%AE%98%E7%BD%91-slidestage.dev-06B6D4?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Proprietary-DC2626?style=flat-square"></a>
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/lang-English-F59E0B?style=flat-square"></a>
</p>

---

SlideStage Lite 可以直接从 `file://`、GitHub Pages、Netlify、Vercel、
内网 Nginx 或任意静态托管打开的静态构建产物。

### SlideStage 全家桶

<table>
  <tr>
    <td align="center" width="33%">
      <a href="https://github.com/SlideStage/SlideStageLite"><img src="public/brand/png/slidestage-mark.png" width="84" alt="SlideStage Lite"></a><br/>
      <strong>SlideStage Lite</strong><br/>
      <sub>本地优先运行时</sub><br/>
      <sub>在任意浏览器里打开、演示、转换 <code>.stage</code>。</sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/SlideStage/SlideStagePro"><img src="public/brand/png/slidestage-pro-mark.png" width="84" alt="SlideStage Pro"></a><br/>
      <strong>SlideStage Pro</strong><br/>
      <sub>自托管平台</sub><br/>
      <sub>多人 deck 库、注释批注、Docker Compose 部署。</sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/SlideStage/slidestage-pack"><img src="public/brand/png/slidestage-pack-mark.png" width="84" alt="slidestage-pack"></a><br/>
      <strong>slidestage-pack</strong><br/>
      <sub>Agent skill 打包器</sub><br/>
      <sub>把任意 HTML deck 打包成 <code>.stage</code> 文件。</sub>
    </td>
  </tr>
</table>

---

## 为什么用 SlideStage Lite？

大多数演示文稿工具会让你在**保真度**（原生 HTML/CSS/JS 动画）和**便携性**
（一个能整体交付的文件）之间二选一。`.stage` 容器调和了二者：
一个带严格清单（manifest）的压缩文件夹，按指纹签名、按显式能力清单授权。
Lite 是这套容器的忠实运行时：

- 完整跑在你的标签页内 —— 无服务器、无埋点、无上传；
- 每张幻灯片都跑在沙箱化 `iframe` 中，遇到声明额外能力的演示包会
  请求**按包授权**（存储、BroadcastChannel、`window.open`）；
- 自带 PowerPoint 级演讲者工具（演讲者视图、概览栅格、激光笔、聚光灯、
  持久墨迹、第二屏观众窗口）；
- 内置实时 HTML → `.stage` 转换器，原生支持 `reveal.js`、`impress.js`、
  `html-ppt-skill`、`huashu-design`、普通 HTML 文件（reveal/impress
  默认 `wrap` 模式，保留全部原生运行时；显式 `--mode split` 可拆为多页）；
- 同时支持英语和简体中文，开箱即用。

---

## 功能一览

| 表面 | 功能 |
|---|---|
| **落地页** | 极简「即开即用」：居中的拖放区（拖入或点击打开 `.stage`），下方是「打开示例」与「转换 HTML」两个次级动作，再加中英语言切换。完整产品介绍在 [slidestage.dev](https://slidestage.dev)。 |
| **DeckViewer（单窗口）** | 全屏黑色舞台 + 底部自动隐藏的演讲者工具栏：画笔、荧光笔、橡皮、激光、聚光、黑/白屏、撤销/清空、持久颜色。 |
| **PresenterView（多窗口）** | 可拖拽宽度的侧栏：下一张缩略、计时器、观众窗口状态；外加可拖拽高度的演讲者备注抽屉。备注按幻灯片可编辑、写入 `localStorage`。 |
| **AudienceView（弹窗）** | 第二屏镜像演示输出：墨迹、当前页、黑屏、聚光、指针通过 `BroadcastChannel` 实时同步。 |
| **信任授权** | 若演示包声明了 `compat.requires`，Lite 会在你为该指纹明确授权之前阻止渲染。 |
| **转换器** | 拖入文件夹 / `.html` / `.zip` / `.stage`，选择转换模式（auto / split / wrap / single / passthrough），下载严格的 `.stage`。 |
| **国际化** | 英语 + 简体中文，键集完全对等由测试强制。优先级：URL `?lang=` → `localStorage` → `navigator.language*`。 |

---

## 快速开始（本地开发）

环境要求：**Node ≥ 20**，**pnpm 10.28+**。

```bash
git clone https://github.com/SlideStage/SlideStageLite.git
cd SlideStageLite

pnpm install
pnpm dev                     # http://localhost:5173/
```

`predev` 钩子会自动生成确定性 fixture，「打开示例演示」按钮开箱即用。

### 验证安装

```bash
pnpm typecheck               # tsc -b --noEmit
pnpm test:unit               # vitest (jsdom)
pnpm test:e2e                # playwright (首次需先 `pnpm test:e2e:install`)
pnpm build                   # tsc -b && vite build → dist/
```

---

## 生产部署

SlideStage Lite 产物是一份纯静态包（`dist/index.html` + `dist/assets/*`），
任何静态托管都能跑。

### 1. 配置环境变量（可选）

复制模板并填入你的备案号（也可以全部留空）：

```bash
cp .env.example .env
$EDITOR .env
```

每个 `VITE_BEIAN_*` 都是**可选**的，留空即不渲染对应内容。
完整规则见下文 [配置](#配置)。

> ⚠️ **任何包含 `#` 的 URL 必须加双引号。** Vite 使用 dotenv 解析 `.env*`，
> 行内 `#` 会被当作注释起点。`VITE_BEIAN_MPS_URL` 的官方查询链接形如
> `https://beian.mps.gov.cn/#/query/webSearch?code=...`，**必须**写成
> `VITE_BEIAN_MPS_URL="https://beian.mps.gov.cn/#/query/..."`（带双引号），
> 否则 `#` 之后的内容会被静默吃掉，备案链接退化为 MPS 首页，
> 等审计来时才发现 404。详见
> [`docs/FOOTER_BEIAN.md`](docs/FOOTER_BEIAN.md)。

### 2. 构建

```bash
pnpm build
```

### 3. 上传 `dist/`

常见配方：

```bash
# Vercel / Netlify 拖拽：
#   项目根目录: SlideStageLite
#   构建命令: pnpm build
#   输出目录: dist

# Nginx（或任意静态 webroot）：
rsync -av --delete dist/ user@host:/var/www/slidestagelite/

# GitHub Pages：
pnpm build
npx gh-pages -d dist
```

就这样 —— 没有数据库、没有 API key、没有运行时配置服务。

---

## 桌面版

SlideStage Lite 同时提供 macOS 与 Windows 桌面版安装包，与 web 版共用
同一份 React 界面与 `.stage` 运行时，通过 Tauri 2 打包。二者复用同一套
in-app 自动更新流程（GitHub Releases 静态 `latest.json` + minisign
签名校验 + `updates.slidestage.dev` 镜像兜底）。

### 下载

最新发布在
<https://github.com/SlideStage/SlideStageLite/releases>。按平台选择：

| 平台                         | 文件名                                                |
| ---------------------------- | ----------------------------------------------------- |
| macOS (Apple Silicon)        | `SlideStageLite-<version>-macOS-AppleSilicon.dmg`     |
| macOS (Intel)                | `SlideStageLite-<version>-macOS-Intel.dmg`            |
| Windows 10/11 (x64)          | `SlideStageLite-<version>-Windows-x64-setup.exe`      |

系统要求：

- macOS 12.0+（Monterey 或更新）。
- Windows 10 1809+ 或 Windows 11；Windows 11 已预装 WebView2 Evergreen
  Runtime，Windows 10 在首次安装时安装器会按需下载。

### 安装（Windows）

1. 下载 `SlideStageLite-<version>-Windows-x64-setup.exe`。
2. 双击运行。**MVP 版本暂未代码签名**，Windows Defender SmartScreen 会
   弹出蓝色的"无法识别的应用"对话框 —— 点 **更多信息** → **仍要运行**
   即可。同一主版本内只需要操作一次，SmartScreen 会记住选择。
3. NSIS 安装器会以 per-user 模式安装（不会弹 UAC 提权），并创建开始
   菜单快捷方式。安装后双击 `.stage` 文件即可在 SlideStage Lite 中打开。

如果点了"仍要运行"之后仍然无法启动安装器：

- 右键下载得到的 `.exe` → **属性** → 勾选最下方"**解除锁定**" →
  **应用** → 重新运行安装器。

我们正在为 Windows 版接入代码签名。规划路线（Azure Trusted Signing /
SignPath / MSIX → 微软商店）记录在
[`docs/WINDOWS_DISTRIBUTION.md`](docs/WINDOWS_DISTRIBUTION.md)。

### 安装（macOS）

1. 下载与你 Mac 芯片匹配的 `.dmg`。
2. 打开磁盘镜像，将 `SlideStage Lite` 图标拖入 `Applications`。
3. macOS Gatekeeper 不会拦截 —— DMG 已通过 Developer ID 证书签名并完成
   Apple 公证装订（notarization staple）。

### 自动更新

安装后，SlideStage Lite 启动时会静默检查更新；也可以通过菜单触发：
**Help → Check for Updates…**（Windows）或 **SlideStage Lite →
Check for Updates…**（macOS）。当有新版本可用时：

- 落地页会出现更新横幅，单击 **安装更新** 即可。
- 下载进度按字节精确显示（服务器返回 `Content-Length` 时）；新版
  压缩包会用编译进可执行文件里的 minisign 公钥校验签名，校验通过后
  静默安装并重启。

横幅可以按版本"不再提醒"——只有严格的更高版本上线时才会再次出现。

### 从源码构建桌面版

除 Quickstart 列出的依赖外还需要：
- **Rust 1.77+**（`rustup install stable`）
- macOS：Xcode Command Line Tools（`xcode-select --install`）
- Windows：Visual Studio Build Tools 2022 + "使用 C++ 的桌面开发"
  工作负载 + Windows 10/11 SDK

```bash
pnpm tauri:dev      # 开发：Tauri + Vite 热重载（不打包安装器）
pnpm tauri:build    # 发布：在 src-tauri/target/<triple>/release/bundle/
                    #   下产出 .dmg / .exe
```

完整发布流水线参考
[`docs/AUTO_UPDATER.md`](docs/AUTO_UPDATER.md)、
[`docs/MACOS_NOTARIZATION.md`](docs/MACOS_NOTARIZATION.md) 与
[`docs/WINDOWS_DISTRIBUTION.md`](docs/WINDOWS_DISTRIBUTION.md)。

---

## 配置

所有配置在构建时通过 Vite 环境变量打包进 bundle。
`pnpm build` 之后再改 `.env` 不会影响已生成的 `dist/`。

| 变量 | 作用 | 留空时 |
|---|---|---|
| `VITE_BEIAN_ICP_TEXT` | 工信部 ICP 备案号文字。 | 不渲染 ICP。 |
| `VITE_BEIAN_ICP_URL` | ICP 链接地址。 | 回退为 `https://beian.miit.gov.cn/`。 |
| `VITE_BEIAN_MPS_TEXT` | 公安备案号文字。 | 不渲染公安备案。 |
| `VITE_BEIAN_MPS_URL` | `beian.mps.gov.cn` 完整查询 URL。 | 降级为非链接 `<span>`（图标 + 文字）。 |


---

## 仓库结构

```
SlideStageLite/
├── src/
│   ├── app/                  # 顶层 SPA 外壳（App, Footer, LanguageSwitcher, ConverterPanel, TrustPrompt）
│   ├── deck/                 # .stage 加载器 + 能力沙箱
│   ├── converter/            # html-ppt-skill / huashu / 普通 HTML → .stage 打包器
│   ├── viewer/               # DeckViewer + DeckStage + AudienceView
│   ├── presenter/            # 工具栏、批注层、激光笔、聚光、黑屏、BroadcastChannel 同步 hook
│   ├── persistence/          # localStorage 封装（备注、批注、信任授权）
│   ├── i18n/                 # I18nProvider + 英/中字典
│   ├── styles/globals.css    # 设计令牌 + 全部组件类（纯 CSS，无 Tailwind）
│   └── main.tsx              # ReactDOM 启动入口
├── bin/convert.ts            # `pnpm convert` CLI（文件夹/HTML/zip → .stage）
├── scripts/build-fixtures.mjs  # 确定性测试 fixture 生成器
├── public/                   # 静态资源（mpslogo.png 用于公安备案芯片，fixtures/ 在 predev/prebuild 自动生成）
├── design-system/            # MASTER 设计规范（令牌、组件、反模式）
├── docs/                     # AI 生成的过程文档（不进 git）
├── tests/                    # Playwright e2e + fixtures（不进 git）
└── .env.example              # 备案号 env 模板 —— 部署时复制为 .env
```

---

## 开发速查表

```bash
pnpm dev          # Vite 开发服务器
pnpm fixtures     # 重新生成确定性 .stage fixture（pre{dev,build,test} 自动跑）
pnpm convert      # CLI：把文件夹 / html / zip 打包为 .stage
pnpm typecheck    # tsc -b --noEmit
pnpm test:unit    # vitest（jsdom + react-dom）
pnpm test:e2e     # playwright chromium
pnpm test         # fixtures + typecheck + unit + e2e
pnpm check        # typecheck + 生产 build（CI 关卡）
pnpm preview      # 启动本地服务器预览 dist/
```

### 技术栈

- **React 19** + **TypeScript 6** + **Vite 8**
- **fflate** 做 zip 打包/解包（~30 KB，无原生依赖）
- **lucide-react** 提供图标（仅 SVG，按设计规范禁用 emoji）
- **zod 4** 做 manifest 校验
- **vitest 4** + **@testing-library/react 16** + **jsdom 29** 做单元测试
- **playwright 1.60** 做 e2e
- **pnpm 10.28+** workspace 友好的包管理器

---

## 许可证

SlideStage Lite 是**专有软件**，完整条款见 [`LICENSE`](LICENSE)。简要说明：

- 允许：在自有项目中私有引用已发布的 `@slidestage/*` npm 包、运行二
  进制制品做个人/内部使用。
- 不允许（未经书面授权）：复制、修改、再分发、转包、白标商用，或
  使用源码训练机器学习模型；不得使用 `public/brand/` 下的商标、Logo
  与品牌资产。

如需商业授权 / OEM / 白标合作，请邮件至
[licensing@slidestage.dev](mailto:licensing@slidestage.dev)。
