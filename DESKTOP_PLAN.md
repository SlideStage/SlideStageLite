# SlidesDeckLite Desktop —— Tauri 2 实施计划书

> 目标：在不破坏现有 Web 版的前提下，给 SlidesDeckLite 套一个 Tauri 2 桌面壳，
> 输出 macOS / Windows / Linux 原生应用，包体 < 15MB、内存 < 80MB、启动 < 1s。

---

## 一、决策摘要

| 项 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Tauri 2** | Rust 主进程 + OS 原生 WebView，包小、内存低、安全模型与 Lite trust 模型同构 |
| 前端 | 复用现有 React 19 + Vite 8 | 0 改动渲染层，仅适配 1 个传输层文件 |
| 多窗口通信 | 抽象 `SyncTransport`，Web 用 BroadcastChannel，Desktop 用 Tauri Event | 两端都 first-class，无后悔药 |
| 文件读写 | 渲染层 File API 优先（拖入/picker），主进程仅做 deep-link / fileAssociations | 保持 Web 版逻辑 100% 复用 |
| 打包 | Tauri 内置（`tauri build`）→ `.dmg` / `.msi` / `.AppImage` | 官方支持，含自动更新插件 |
| 自动更新 | `tauri-plugin-updater`（后续阶段加入） | 与 SlidesDeckPro 自托管 endpoint 对接 |

---

## 二、架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                  SlidesDeckLite (Web 版,不变)                 │
│  Vite + React 19 + TS  →  dist/  (静态文件,GitHub Pages 等)   │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │ 共享 src/ 渲染层
                              │
┌──────────────────────────────────────────────────────────────┐
│           SlidesDeckLite Desktop (Tauri 2 新增)                │
│                                                                │
│  ┌─────────────────┐         ┌──────────────────────────────┐│
│  │ src-tauri/      │  IPC    │  WebviewWindow: main          ││
│  │ (Rust 主进程)    │◀───────▶│  ┌──────────────────────────┐││
│  │ - 窗口生命周期   │ Event   │  │ React App (env=desktop)  │││
│  │ - 文件关联       │ ◀──────▶│  │ - usePresentationSync    │││
│  │ - deep-link      │         │  │   ↑ TauriEventTransport  │││
│  │ - 单例守护       │         │  └──────────────────────────┘││
│  └─────────────────┘         └──────────────────────────────┘│
│                                                                │
│                              ┌──────────────────────────────┐│
│                     Event    │  WebviewWindow: audience      ││
│                     ◀───────▶│  ┌──────────────────────────┐││
│                              │  │ React App (?audience=1)  │││
│                              │  └──────────────────────────┘││
│                              └──────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**关键不变量**：渲染层代码对 "我跑在浏览器/桌面" 几乎无感。
唯一感知点在 `usePresentationSync.ts` 和 `openAudienceWindow`，
通过运行时检测 `window.__TAURI_INTERNALS__` 切换实现。

---

## 三、项目结构变更

```
SlidesDeckLite/
├── src/                          ← 不变（少量 transport 抽象重构）
│   └── presenter/
│       ├── usePresentationSync.ts    ← 改为 transport-agnostic（保持公共 API）
│       └── transport/                ← 新增
│           ├── types.ts                  接口定义
│           ├── broadcastChannel.ts       Web 实现
│           ├── tauriEvent.ts             Desktop 实现
│           └── detect.ts                 运行时检测
│   └── desktop/                      ← 新增（仅在 Tauri 环境激活）
│       ├── audienceWindow.ts             Tauri 窗口管理
│       ├── fileOpen.ts                   监听 file-open 事件
│       └── env.ts                        isTauri() 工具
├── src-tauri/                    ← 新增（Tauri 主进程）
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json              capability ACL
│   ├── icons/                        多平台图标
│   └── src/
│       ├── main.rs
│       └── lib.rs                    自定义命令 + 事件
├── docs/
│   ├── DESKTOP_PLAN.md           ← 本文件
│   └── DESKTOP_PROGRESS.md       ← 实施记录(完成后产出)
├── tests/
│   ├── e2e/                          Web 模式 Playwright（不变）
│   └── desktop/                  ← 新增
│       ├── smoke.spec.ts             tauri-driver / WebDriver 烟雾测试
│       └── sync.unit.test.ts         transport 抽象的单测
├── vite.config.ts                ← 加 Tauri 适配（envPrefix, server.strictPort）
└── package.json                  ← 加 tauri scripts + 依赖
```

---

## 四、技术细节

### 4.1 传输层抽象（核心）

```ts
// src/presenter/transport/types.ts
export interface SyncTransport {
  postMessage(msg: AudienceMessage): void;
  subscribe(handler: (msg: AudienceMessage) => void): () => void;
  close(): void;
}

export interface TransportFactory {
  create(channelName: string): SyncTransport;
  isAvailable(): boolean;
}
```

```ts
// src/presenter/transport/broadcastChannel.ts
export const broadcastChannelFactory: TransportFactory = {
  isAvailable: () => typeof BroadcastChannel !== 'undefined',
  create(name) {
    const ch = new BroadcastChannel(name);
    return {
      postMessage: (msg) => ch.postMessage(msg),
      subscribe: (h) => {
        const listener = (e: MessageEvent) => h(e.data);
        ch.addEventListener('message', listener);
        return () => ch.removeEventListener('message', listener);
      },
      close: () => ch.close(),
    };
  },
};
```

```ts
// src/presenter/transport/tauriEvent.ts (仅 Tauri 环境会加载)
import { emit, listen } from '@tauri-apps/api/event';
export const tauriEventFactory: TransportFactory = {
  isAvailable: () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  create(name) {
    const channel = `hcslides:${name}`;
    let unlisten: Promise<() => void> | null = null;
    return {
      postMessage: (msg) => { emit(channel, msg); },
      subscribe: (h) => {
        unlisten = listen<AudienceMessage>(channel, (e) => h(e.payload));
        return () => unlisten?.then((u) => u());
      },
      close: () => unlisten?.then((u) => u()),
    };
  },
};
```

```ts
// src/presenter/transport/detect.ts
export function pickTransport(): TransportFactory {
  if (tauriEventFactory.isAvailable()) return tauriEventFactory;
  if (broadcastChannelFactory.isAvailable()) return broadcastChannelFactory;
  return noopFactory;
}
```

`usePresentationSync.ts` 的 28 行内部逻辑改成调用 `pickTransport()`，
外部 API 完全不变。

### 4.2 观众窗口管理

```ts
// src/desktop/audienceWindow.ts
import { WebviewWindow, getCurrentWindow } from '@tauri-apps/api/webviewWindow';

export async function openAudienceWindow(fingerprint: string): Promise<void> {
  const label = `audience-${fingerprint.slice(0, 12)}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) { await existing.setFocus(); return; }

  await new WebviewWindow(label, {
    url: `/?audience=1&deck=${encodeURIComponent(fingerprint)}`,
    title: 'SlidesDeckLite — Audience',
    width: 1280, height: 720,
    decorations: true, resizable: true,
  }).once('tauri://created', () => {/* track */});
}
```

`DeckViewer.tsx` 的 `openAudienceWindow` 改为：

```ts
const openAudienceWindow = useCallback(async () => {
  if (isTauri()) {
    await (await import('../desktop/audienceWindow')).openAudienceWindow(deck.fingerprint);
  } else {
    // 现有 window.open 逻辑保留
  }
}, [deck.fingerprint]);
```

### 4.3 文件关联与 deep-link

```json
// src-tauri/tauri.conf.json (节选)
{
  "bundle": {
    "fileAssociations": [
      {
        "ext": ["hcslides"],
        "name": "HCSlides Deck",
        "description": "SlidesDeck presentation",
        "role": "Viewer",
        "mimeType": "application/x-hcslides"
      }
    ]
  },
  "plugins": {
    "deep-link": { "desktop": { "schemes": ["hcslides"] } }
  }
}
```

主进程在 `lib.rs` 监听文件打开事件，转发给前端：

```rust
// src-tauri/src/lib.rs
#[tauri::command]
async fn pending_file(app: tauri::AppHandle) -> Option<String> {
    app.state::<PendingFile>().0.lock().unwrap().take()
}

// 在 .setup() 里收到 file-open 时 emit "deck:open" event
```

前端 `src/desktop/fileOpen.ts` 在启动时 `listen('deck:open')`，
拿到路径后 `invoke('read_deck_bytes', { path })` → 喂给 `loadDeck`。

### 4.4 Tauri capabilities ACL（与 Lite trust 模型同构）

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Baseline: main window can manage audience windows and read deck files picked by user",
  "windows": ["main", "audience-*"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:webview:allow-create-webview-window",
    "core:event:allow-emit",
    "core:event:allow-listen",
    "fs:allow-read-file",
    "fs:scope-deck-files"
  ]
}
```

`fs:scope-deck-files` 是自定义 scope，只允许读已通过 dialog 选择的 `.hcslides` 文件。
**这与 Lite 的 per-deck trust 模型在哲学上完全一致**：能力按需开放、用户显式授权、范围最小化。

---

## 五、实施阶段

### Phase 0 — 环境与脚手架（本次完成）
- [x] 调研框架对比、出报告、用户决策（已完成）
- [x] 撰写计划书（本文件）
- [ ] 安装 Rust + 验证 Xcode CLT
- [ ] 初始化 `src-tauri/`
- [ ] 配置 `tauri.conf.json`、`vite.config.ts`、`package.json` scripts

### Phase 1 — 传输层抽象与多窗口
- [ ] 实现 `src/presenter/transport/*`
- [ ] 重构 `usePresentationSync.ts`（保持外部 API）
- [ ] 加 transport 单测覆盖
- [ ] 实现 `src/desktop/audienceWindow.ts`
- [ ] 改 `DeckViewer.tsx` 的 `openAudienceWindow`

### Phase 2 — 文件系统集成
- [ ] Rust 命令 `read_deck_bytes(path)` → `Vec<u8>`
- [ ] `tauri.conf.json` 注册 `.hcslides` fileAssociations
- [ ] `src/desktop/fileOpen.ts` 监听 `deck:open` 事件
- [ ] 启动时检查 `pending_file` 命令处理首次打开

### Phase 3 — 测试基础设施
- [ ] Vitest 单测：BroadcastChannel transport（jsdom 原生支持）
- [ ] Vitest 单测：Tauri transport（mock `@tauri-apps/api/event`）
- [ ] Tauri 烟雾测试：手动启动 → 截图验证主窗口可见

### Phase 4 — 编译与签名
- [ ] `pnpm tauri build` 编译 macOS Universal `.dmg`
- [ ] 验证产物大小 < 15MB、首次启动 < 1s
- [ ] （可选）Apple Developer ID 签名 + Notarize（用户后续配置）

### Phase 5 — 运行验证
- [ ] 打开 app，验证 landing 页面渲染
- [ ] 用 `pnpm fixtures` 生成的 `.hcslides` 文件测试 deck open
- [ ] 验证 presenter view 打开 audience window 后双窗同步

### Phase 6 — 后续（不在本批次）
- [ ] Windows / Linux 交叉编译（GH Actions matrix）
- [ ] `tauri-plugin-updater` 接 SlidesDeckPro 自托管 endpoint
- [ ] 单例模式（防止多个 SlidesDeckLite 实例打开同一 deck）
- [ ] tray icon + global shortcut 启动 presenter
- [ ] iOS / Android（Tauri 2 mobile，复用同一 codebase）

---

## 六、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 老 macOS（< 12）WKWebView 渲染差异 | 中 | 中 | `tauri.conf.json` minimumSystemVersion = "12.0"；CI 加 macOS 12 截图对比 |
| Vite 8 + Tauri CLI 兼容性 | 低 | 高 | Tauri 2.6+ 官方支持 Vite 8；如有问题降级到 Vite 7 LTS |
| Rust 编译时间影响开发体验 | 中 | 低 | 主进程逻辑很少，`cargo build` < 10s；用 `tauri dev` watch |
| fileAssociations 在 macOS 需要安装一次才生效 | 高 | 低 | README 写明：首次打开 `.dmg` 后系统才会注册关联 |
| BroadcastChannel 测试在 Tauri WebView 环境需要 mock | 高 | 低 | 用环境检测 + factory pattern 完全隔离 |

---

## 七、验收标准

1. ✅ `pnpm dev` 仍跑 Vite Web 版（不破坏现有开发体验）
2. ✅ `pnpm tauri dev` 启动 Tauri Desktop dev 模式
3. ✅ `pnpm tauri build` 产出 `.dmg`，大小 < 15MB
4. ✅ 所有现有单测（194+）继续通过
5. ✅ 新增 transport 抽象单测，覆盖 BroadcastChannel + Tauri 两条路径
6. ✅ 桌面 app 启动 < 1s，内存 < 100MB
7. ✅ Presenter window 打开 Audience window 后，翻页/批注实时同步
8. ✅ 双击 `.hcslides` 能从 Finder 启动 app 并自动加载

---

## 八、时间线（保守估计 3-4 周）

| 周 | 阶段 | 产出 |
|---|---|---|
| W1 | Phase 0-1 | 脚手架完成、双窗口通信跑通、`pnpm tauri dev` 可演示 |
| W2 | Phase 2-3 | 文件关联、deep-link、测试覆盖率达标 |
| W3 | Phase 4-5 | macOS `.dmg` 编译、签名、完整功能验证 |
| W4 | 缓冲 | Bug 修复、文档完善、Windows/Linux CI 矩阵（如有时间） |

---

## 九、本次会话目标

按你的要求 "**给一个完整的可执行的计划书 + 生成总结性 Markdown 文档 + 生成测试脚本 + 编译 + 运行**"，本次会话完成：

1. ✅ 本计划书 (`docs/DESKTOP_PLAN.md`)
2. ⏳ Phase 0 全部
3. ⏳ Phase 1 全部
4. ⏳ Phase 2 的 fileAssociations 配置（实际文件打开命令留作后续）
5. ⏳ Phase 3 的 transport 单测
6. ⏳ Phase 4 的 macOS `.dmg` 编译
7. ⏳ Phase 5 的首次运行验证
8. ⏳ 实施记录 (`docs/DESKTOP_PROGRESS.md`)

后续 Phase 6 留给后续迭代，每个都是独立 PR 级别的工作量。

