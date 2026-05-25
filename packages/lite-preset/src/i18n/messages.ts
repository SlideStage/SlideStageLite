/**
 * Translatable strings for the entire Lite SPA.
 *
 * Conventions:
 * - Keys are dot-separated by feature area: `app.header.brandTag`,
 *   `viewer.toolbar.overview`, etc. Keep them readable instead of clever.
 * - Every key must exist in every locale dictionary. The parity test in
 *   `messages.test.ts` enforces this — failing to add a translation will
 *   break unit tests, not silently fall back to English.
 * - Use `{name}` placeholders. `format()` interpolates them safely (escapes
 *   nothing, callers are responsible for trusted values).
 * - Hero/long copy is split into segments instead of HTML-in-string so we
 *   keep markup ownership in JSX. See `App.tsx` consumer for the pattern.
 */
import { DEFAULT_LOCALE, type Locale } from './locales';

export type MessageDict = Readonly<Record<string, string>>;

export const messages: Readonly<Record<Locale, MessageDict>> = {
  en: {
    'app.brand.name': 'SlideStage Lite',
    'app.brand.tag': 'lite',
    'app.brand.aria': 'SlideStage Lite home',
    'app.header.meta': 'Local · no server',

    'language.aria': 'Interface language',
    'language.menu': 'Language',

    'landing.dropzone.idle': 'Open a .stage deck',
    'landing.dropzone.dragging': 'Release to open',
    'landing.dropzone.help':
      'Drop a .stage file here, or click to choose one from disk.',
    'landing.cta.open': 'Open .stage',
    'landing.cta.convert.show': 'Convert from HTML deck',
    'landing.cta.convert.hide': 'Hide converter',
    'landing.cta.sample': 'Open sample deck',
    'landing.status.loading': 'Loading deck…',

    'errors.loadDeckFallback': 'Failed to load the selected deck.',
    'errors.sampleMissing': 'Sample fixture is missing. Run pnpm fixtures and reload.',
    'errors.sampleFallback': 'Failed to load sample deck.',
    'errors.trustDenied': 'E_TRUST_DENIED: required capabilities were not granted.',
    'errors.tooLargeForInline':
      'E_TOO_LARGE_FOR_INLINE: This deck is larger than the inline budget and your ' +
      "browser environment can't host the service worker that would render it " +
      'efficiently. Try opening it in Chrome, Brave, or the SlideStage desktop app, ' +
      'or repackage the deck with smaller fonts/images.',

    'viewer.notice.autoElevatedSize':
      'This deck weighs in at {mb} MB. To render it efficiently, SlideStage Lite ' +
      'mounted it with same-origin access (so the in-tab service worker can serve ' +
      'its assets without inlining every byte as a data: URL). The deck can read ' +
      'browser storage for this site while it is open.',
    'viewer.notice.dismiss': 'Dismiss',

    'trust.eyebrow': 'Trust required',
    'trust.lead.before': 'This deck was packaged in a mode that needs extra browser capabilities to render faithfully. SlideStage Lite will not enable them until you grant trust for',
    'trust.lead.emphasis': 'this specific deck',
    'trust.lead.after': '.',
    'trust.producerNote': 'Producer note:',
    'trust.warning':
      "Granting trust lets this deck's scripts read browser storage on this site, talk to sibling tabs, or open new windows. The decision is remembered per-deck (fingerprint sha256) until you clear browser storage. Open without trust by closing this dialog.",
    'trust.cancel': 'Cancel',
    'trust.grant': 'Grant trust & open',

    'converter.title': 'Convert from HTML deck',
    'converter.close': 'Close converter',
    'converter.intro.before': 'Pack an',
    'converter.intro.mid': ', or plain HTML deck into a strict',
    'converter.intro.after': '. Conversion runs entirely in this tab.',
    'converter.step.source': 'Source',
    'converter.step.mode': 'Conversion mode',
    'converter.step.mirror': 'Offline mirror (optional)',
    'converter.step.output': 'Output',
    'converter.drop.idle': 'Drag a file or folder here',
    'converter.drop.dragging': 'Release to load',
    'converter.drop.help':
      '.html / .htm / .zip / .stage, or a deck folder (subfolders are walked recursively).',
    'converter.drop.pickFile': 'Pick a file',
    'converter.drop.pickAnother': 'Choose another file',
    'converter.drop.pickFolder': 'Pick a folder',
    'converter.field.mode': 'Mode',
    'converter.mode.auto.label': 'Auto (recommended)',
    'converter.mode.auto.help': 'Pick the default for the sniffed kind.',
    'converter.mode.split.help': 'One slide per section; Lite owns navigation.',
    'converter.mode.wrap.help':
      'Single wrapper slide; preserves original runtime (trust required).',
    'converter.mode.single.help': 'Single slide; plain-html shape.',
    'converter.mode.passthrough.help':
      'For .stage input; re-emit after schema validation.',
    'converter.actions.load': 'Convert & Load',
    'converter.actions.loading': 'Converting…',
    'converter.actions.download': 'Convert & Download',
    'converter.errors.noDrop': 'No droppable file or folder detected.',
    'converter.errors.dropRead': 'Could not read the dropped item.',
    'converter.errors.folderRead': 'Could not read selected folder.',
    'converter.errors.convert': 'Conversion failed.',
    'converter.errors.loadAfter': 'Failed to load the converted deck.',
    'converter.result.slide.singular': 'slide',
    'converter.result.slide.plural': 'slides',
    'converter.result.warning.singular': 'warning',
    'converter.result.warning.plural': 'warnings',
    'converter.result.summary':
      'Converted {count} {label} as {mode} from {source}. {warnings}',
    'converter.result.warnings.none': 'No warnings.',
    'converter.result.warnings.some': '{n} {label}.',
    'converter.result.toggle.show': 'Show report',
    'converter.result.toggle.hide': 'Hide report',

    'converter.mirror.label': 'Pre-download external assets (offline ready)',
    'converter.mirror.help':
      'Fetch every https:// image, font, video and stylesheet referenced in the slides and bundle them into the package. Some CDNs block cross-origin reads; use the `pnpm mirror` CLI for the strongest coverage.',
    'converter.mirror.progress':
      'Mirror {phase}: {done}/{queued} ({mib} MiB downloaded)',
    'converter.mirror.summary.ready':
      'Offline ready: mirrored {mirrored} assets ({mib} MiB).',
    'converter.mirror.summary.partial':
      'Partial offline: mirrored {mirrored}, skipped {skipped} ({mib} MiB).',

    'viewer.aria.deckViewer': 'Deck viewer',
    'viewer.aria.slideCounter': 'Slide counter',
    'viewer.aria.previous': 'previous slide',
    'viewer.aria.next': 'next slide',
    'viewer.aria.closeDeck': 'close deck',
    'viewer.aria.backToViewer': 'back to viewer',
    'viewer.aria.resizeSide': 'Resize side panel',
    'viewer.aria.resizeNotes': 'Resize speaker notes',
    'viewer.aria.presenterSide': 'presenter side panel',
    'viewer.aria.speakerPanel': 'speaker notes',
    'viewer.aria.closeSpeaker': 'close speaker view',

    'viewer.action.closeDeck': 'Close deck',
    'viewer.action.singleWindow': 'Single window',
    'viewer.action.overview': 'Overview (O)',
    'viewer.action.speaker': 'Speaker (S)',
    'viewer.action.presenterView': 'Presenter view',
    'viewer.action.presenterViewHint':
      'Open presenter view with sidebar + audience window',
    'viewer.action.openAudience': 'Open audience window',
    'viewer.action.audienceLive': 'Audience window: Live',
    'viewer.action.closeSpeakerS': 'Close (S)',

    'viewer.monitorPicker.title': 'Where should the audience window open?',
    'viewer.monitorPicker.desc':
      'Pick a display. The audience window will open native-fullscreen so the OS gives it its own Space. You can exit fullscreen from the audience window at any time.',
    'viewer.monitorPicker.recommended': 'Recommended',
    'viewer.monitorPicker.primary': 'Primary display',
    'viewer.monitorPicker.secondary': 'External display',
    'viewer.monitorPicker.size': '{w} × {h} @ {scale}x',
    'viewer.monitorPicker.cancel': 'Cancel',
    'viewer.monitorPicker.fullscreen': 'Fullscreen',
    'viewer.monitorPicker.windowed': 'Open as window',

    'viewer.title.next.live': 'Next slide {n}: {label}',
    'viewer.title.current.live': 'Slide {n}: {label}',
    'viewer.title.audience.live': 'Audience slide {n}: {label}',
    'viewer.notes.title': 'Speaker notes',
    'viewer.notes.editedLocally': '• edited locally',
    'viewer.notes.placeholder': 'Add a note for this slide... (Markdown supported)',
    'viewer.notes.empty': 'No speaker notes for this slide.',
    'viewer.notes.reset': 'Reset',
    'viewer.notes.edit': 'Edit',
    'viewer.notes.done': 'Done',
    'viewer.notes.slideMeta': 'Slide {n}: {label}',

    'viewer.speaker.title': 'Speaker view',
    'viewer.speaker.current': 'Current ({n} / {total})',
    'viewer.speaker.next': 'Next',
    'viewer.speaker.endOfDeck': '— end of deck —',
    'viewer.speaker.endOfDeckPlain': '- end of deck -',
    'viewer.side.upNext': 'Up next',
    'viewer.side.timer': 'Timer',
    'viewer.side.timer.reset': 'Reset',
    'viewer.side.audience': 'Audience window',
    'viewer.audience.live': 'Live',
    'viewer.audience.disconnected': 'Disconnected',
    'viewer.audience.liveHelp':
      'Strokes, slide index, blackout, spotlight and cursor mirror in real time.',
    'viewer.audience.idleHelp':
      'Click the top button to launch the audience window.',

    'overview.title': 'Overview',
    'overview.aria': 'Overview',
    'overview.close': 'Close',

    'speakerNotes.title': 'Speaker Notes',
    'speakerNotes.aria': 'Speaker notes',
    'speakerNotes.close': 'Close',
    'speakerNotes.empty': 'No speaker notes for this slide.',

    'audience.aria': 'Audience view',
    'audience.waiting.title': 'Audience window',
    'audience.waiting.body': 'Waiting for a presenter window to send the current deck...',
    'audience.linked': 'Linked',
    'audience.waitingShort': 'Waiting for presenter...',
    'audience.exitFullscreen': 'Exit fullscreen',
    'audience.enterFullscreen': 'Fullscreen',
    'audience.closeWindow': 'Close audience window',

    'toolbar.aria': 'Presenter tools',
    'toolbar.handle.expand': 'Show presenter tools',
    'toolbar.handle.collapse': 'Hide presenter tools',
    'toolbar.handle.fallback': 'TOOLS',
    'toolbar.tool.pointer': 'Pointer',
    'toolbar.tool.laser': 'Laser',
    'toolbar.tool.pen': 'Pen',
    'toolbar.tool.highlighter': 'Highlighter',
    'toolbar.tool.eraser': 'Eraser',
    'toolbar.tool.spotlight': 'Spotlight',
    'toolbar.tool.black': 'Black',
    'toolbar.tool.white': 'White',
    'toolbar.tool.undo': 'Undo',
    'toolbar.tool.clear': 'Clear',
    'toolbar.tip.undo': 'Undo last stroke (Ctrl+Z)',
    'toolbar.tip.clear': 'Clear annotations on this slide (Shift+Delete)',
    'toolbar.tip.tool': '{label} ({shortcut})',
    'toolbar.tip.color': '{color} ({n})',
    'toolbar.aria.color': 'drawing color {color}',
    'toolbar.aria.activeColor': 'active color {color}',
    'toolbar.spotlight.size': 'Size',
    'toolbar.spotlight.aria': 'Spotlight size, currently {n} pixels',

    'trust.cap.same-origin-storage.title': 'Same-origin storage',
    'trust.cap.same-origin-storage.desc':
      'Read and write cookies, localStorage and IndexedDB scoped to this site, and share state with sibling tabs of the same deck.',
    'trust.cap.broadcast-channel.title': 'Cross-tab coordination',
    'trust.cap.broadcast-channel.desc':
      'Send and receive BroadcastChannel messages between tabs (requires same-origin scripting).',
    'trust.cap.window-open.title': 'Open new browser windows',
    'trust.cap.window-open.desc':
      'Pop a new browser window or tab (for presenter / audience splits, external previews, or hand-offs).',

    'footer.local': 'Runs locally · no server',
    'footer.site': 'slidestage.dev',

    'update.body':
      'A new version ({version}) of SlideStage Lite is available.',
    'update.cta.install': 'Install update',
    'update.cta.retry': 'Try again',
    'update.dismiss': 'Dismiss update notice',
    'update.progress.body': 'Downloading SlideStage Lite {version}…',
    'update.progress.detail': '{downloaded} / {total}',
    'update.progress.detailUnknown': '{downloaded} downloaded',
    'update.installing': 'Installing update… don’t quit the app.',
    'update.restarting': 'Update installed — relaunching SlideStage Lite.',
    'update.error': 'Update failed: {message}',

    'menu.checkUpdate.upToDate.title': 'You’re up to date',
    'menu.checkUpdate.upToDate.body':
      'SlideStage Lite is up to date.\nYou’re running v{version}.',
    'menu.checkUpdate.available.title': 'Update available',
    'menu.checkUpdate.available.body':
      'SlideStage Lite v{version} is available. Install it now? The app will relaunch when the install finishes.',
    'menu.checkUpdate.available.install': 'Install Now',
    'menu.checkUpdate.available.later': 'Later',
    'menu.checkUpdate.error.title': 'Update check failed',
    'menu.checkUpdate.error.body':
      'Could not check for updates: {message}',
    'menu.checkUpdate.installError.title': 'Update failed',
    'menu.checkUpdate.installError.body':
      'The update could not be installed: {message}',
  },

  'zh-CN': {
    'app.brand.name': 'SlideStage Lite',
    'app.brand.tag': 'lite',
    'app.brand.aria': 'SlideStage Lite 主页',
    'app.header.meta': '本地运行 · 无服务端',

    'language.aria': '界面语言',
    'language.menu': '语言',

    'landing.dropzone.idle': '打开 .stage 演示包',
    'landing.dropzone.dragging': '松开以打开',
    'landing.dropzone.help':
      '把 .stage 文件拖到此处，或点击从磁盘选择。',
    'landing.cta.open': '打开 .stage',
    'landing.cta.convert.show': '转换 HTML 演示',
    'landing.cta.convert.hide': '收起转换器',
    'landing.cta.sample': '打开示例演示',
    'landing.status.loading': '正在加载演示…',

    'errors.loadDeckFallback': '无法加载所选演示包。',
    'errors.sampleMissing': '示例 fixture 缺失，请运行 pnpm fixtures 后刷新。',
    'errors.sampleFallback': '无法加载示例演示。',
    'errors.trustDenied': 'E_TRUST_DENIED：未授予所需的浏览器能力。',
    'errors.tooLargeForInline':
      'E_TOO_LARGE_FOR_INLINE：该 deck 超过 inline 预算，当前浏览器环境也无法承载用来高效渲染的 service worker。请改用 Chrome / Brave / SlideStage 桌面版打开，或者把字体/图片瘦身后重新打包。',

    'viewer.notice.autoElevatedSize':
      '该 deck 体积达 {mb} MB。为了高效渲染，SlideStage Lite 已用同源（same-origin）方式装载它，让标签内的 Service Worker 直接提供资源，而非把每个字节 inline 成 data: URL。在打开期间，该 deck 可以读取本站浏览器存储。',
    'viewer.notice.dismiss': '关闭提示',

    'trust.eyebrow': '需要信任授权',
    'trust.lead.before':
      '此演示打包时声明需要额外的浏览器能力才能完整呈现。SlideStage Lite 在你为',
    'trust.lead.emphasis': '该具体演示',
    'trust.lead.after': '授权之前不会启用这些能力。',
    'trust.producerNote': '作者备注：',
    'trust.warning':
      '授予信任后，本演示的脚本可在本站读取浏览器存储、与同源标签页通信，或打开新窗口。该决定会按演示（sha256 指纹）记忆，直到你清除浏览器存储。如需以无信任模式打开，请直接关闭该对话框。',
    'trust.cancel': '取消',
    'trust.grant': '授予信任并打开',

    'converter.title': '从 HTML 演示转换',
    'converter.close': '关闭转换器',
    'converter.intro.before': '把',
    'converter.intro.mid': '或纯 HTML 演示，打包为严格的',
    'converter.intro.after': '。转换全部在当前标签页内完成。',
    'converter.step.source': '来源',
    'converter.step.mode': '转换模式',
    'converter.step.mirror': '离线镜像（可选）',
    'converter.step.output': '产物',
    'converter.drop.idle': '把文件或文件夹拖到此处',
    'converter.drop.dragging': '松开以加载',
    'converter.drop.help':
      '支持 .html / .htm / .zip / .stage，或一整个演示文件夹（递归遍历子目录）。',
    'converter.drop.pickFile': '选择文件',
    'converter.drop.pickAnother': '更换文件',
    'converter.drop.pickFolder': '选择文件夹',
    'converter.field.mode': '模式',
    'converter.mode.auto.label': '自动（推荐）',
    'converter.mode.auto.help': '根据嗅探到的来源类型挑选默认值。',
    'converter.mode.split.help': '按章节切片，每张幻灯片一节；导航由 Lite 接管。',
    'converter.mode.wrap.help':
      '单包装幻灯片，保留原运行时（需要信任授权）。',
    'converter.mode.single.help': '单张幻灯片，使用 plain-html 形态。',
    'converter.mode.passthrough.help':
      '针对 .stage 输入，经清单校验后原样输出。',
    'converter.actions.load': '转换并打开',
    'converter.actions.loading': '正在转换…',
    'converter.actions.download': '转换并下载',
    'converter.errors.noDrop': '未检测到可放入的文件或文件夹。',
    'converter.errors.dropRead': '读取拖入项失败。',
    'converter.errors.folderRead': '读取所选文件夹失败。',
    'converter.errors.convert': '转换失败。',
    'converter.errors.loadAfter': '加载转换后的演示失败。',
    'converter.result.slide.singular': '张幻灯片',
    'converter.result.slide.plural': '张幻灯片',
    'converter.result.warning.singular': '条警告',
    'converter.result.warning.plural': '条警告',
    'converter.result.summary':
      '已从 {source} 转换 {count} {label}，模式为 {mode}。{warnings}',
    'converter.result.warnings.none': '无警告。',
    'converter.result.warnings.some': '{n} {label}。',
    'converter.result.toggle.show': '查看报告',
    'converter.result.toggle.hide': '隐藏报告',

    'converter.mirror.label': '预下载外部资源（离线就绪）',
    'converter.mirror.help':
      '抓取幻灯片里所有 https:// 引用的图片 / 字体 / 视频 / 样式，并打包进 .stage。部分 CDN 会阻止跨源读取；如需最完整的覆盖，建议改用命令行 `pnpm mirror`。',
    'converter.mirror.progress':
      '镜像 {phase}：{done}/{queued}（已下载 {mib} MiB）',
    'converter.mirror.summary.ready':
      '离线就绪：已镜像 {mirrored} 个资源（{mib} MiB）。',
    'converter.mirror.summary.partial':
      '部分离线：已镜像 {mirrored}，跳过 {skipped}（{mib} MiB）。',

    'viewer.aria.deckViewer': '演示查看器',
    'viewer.aria.slideCounter': '幻灯片计数器',
    'viewer.aria.previous': '上一张',
    'viewer.aria.next': '下一张',
    'viewer.aria.closeDeck': '关闭演示',
    'viewer.aria.backToViewer': '返回查看器',
    'viewer.aria.resizeSide': '调整侧栏宽度',
    'viewer.aria.resizeNotes': '调整备注高度',
    'viewer.aria.presenterSide': '演讲者侧栏',
    'viewer.aria.speakerPanel': '演讲者备注',
    'viewer.aria.closeSpeaker': '关闭演讲者视图',

    'viewer.action.closeDeck': '关闭演示',
    'viewer.action.singleWindow': '单窗口模式',
    'viewer.action.overview': '概览 (O)',
    'viewer.action.speaker': '演讲者 (S)',
    'viewer.action.presenterView': '演讲者视图',
    'viewer.action.presenterViewHint': '打开演讲者视图，含侧栏和观众窗口',
    'viewer.action.openAudience': '打开观众窗口',
    'viewer.action.audienceLive': '观众窗口：已连接',
    'viewer.action.closeSpeakerS': '关闭 (S)',

    'viewer.monitorPicker.title': '在哪个显示器打开观众窗？',
    'viewer.monitorPicker.desc':
      '选择一个显示器。观众窗会以原生全屏方式打开（macOS 会自动分配一个独立桌面）。打开后可随时从观众窗退出全屏。',
    'viewer.monitorPicker.recommended': '推荐',
    'viewer.monitorPicker.primary': '主显示器',
    'viewer.monitorPicker.secondary': '外接显示器',
    'viewer.monitorPicker.size': '{w} × {h} @ {scale}x',
    'viewer.monitorPicker.cancel': '取消',
    'viewer.monitorPicker.fullscreen': '全屏播放',
    'viewer.monitorPicker.windowed': '以窗口模式打开',

    'viewer.title.next.live': '下一张幻灯片 {n}：{label}',
    'viewer.title.current.live': '幻灯片 {n}：{label}',
    'viewer.title.audience.live': '观众幻灯片 {n}：{label}',
    'viewer.notes.title': '演讲者备注',
    'viewer.notes.editedLocally': '· 已在本地修改',
    'viewer.notes.placeholder': '为这张幻灯片添加备注…（支持 Markdown）',
    'viewer.notes.empty': '这张幻灯片暂无备注。',
    'viewer.notes.reset': '恢复',
    'viewer.notes.edit': '编辑',
    'viewer.notes.done': '完成',
    'viewer.notes.slideMeta': '幻灯片 {n}：{label}',

    'viewer.speaker.title': '演讲者视图',
    'viewer.speaker.current': '当前 ({n} / {total})',
    'viewer.speaker.next': '下一张',
    'viewer.speaker.endOfDeck': '—— 演示结束 ——',
    'viewer.speaker.endOfDeckPlain': '- 演示结束 -',
    'viewer.side.upNext': '下一张',
    'viewer.side.timer': '计时器',
    'viewer.side.timer.reset': '重置',
    'viewer.side.audience': '观众窗口',
    'viewer.audience.live': '已连接',
    'viewer.audience.disconnected': '未连接',
    'viewer.audience.liveHelp': '墨迹、当前页、黑屏、聚光与光标都会实时镜像过去。',
    'viewer.audience.idleHelp': '点击上方按钮即可打开观众窗口。',

    'overview.title': '概览',
    'overview.aria': '概览',
    'overview.close': '关闭',

    'speakerNotes.title': '演讲者备注',
    'speakerNotes.aria': '演讲者备注',
    'speakerNotes.close': '关闭',
    'speakerNotes.empty': '这张幻灯片暂无备注。',

    'audience.aria': '观众视图',
    'audience.waiting.title': '观众窗口',
    'audience.waiting.body': '等待演讲者窗口发送当前演示…',
    'audience.linked': '已连接',
    'audience.waitingShort': '等待演讲者…',
    'audience.exitFullscreen': '退出全屏',
    'audience.enterFullscreen': '全屏',
    'audience.closeWindow': '关闭观众窗口',

    'toolbar.aria': '演讲者工具',
    'toolbar.handle.expand': '展开演讲者工具',
    'toolbar.handle.collapse': '收起演讲者工具',
    'toolbar.handle.fallback': '工具',
    'toolbar.tool.pointer': '指针',
    'toolbar.tool.laser': '激光笔',
    'toolbar.tool.pen': '画笔',
    'toolbar.tool.highlighter': '荧光笔',
    'toolbar.tool.eraser': '橡皮',
    'toolbar.tool.spotlight': '聚光灯',
    'toolbar.tool.black': '黑屏',
    'toolbar.tool.white': '白屏',
    'toolbar.tool.undo': '撤销',
    'toolbar.tool.clear': '清空',
    'toolbar.tip.undo': '撤销上一笔 (Ctrl+Z)',
    'toolbar.tip.clear': '清空本张批注 (Shift+Delete)',
    'toolbar.tip.tool': '{label}（{shortcut}）',
    'toolbar.tip.color': '{color}（{n}）',
    'toolbar.aria.color': '画笔颜色 {color}',
    'toolbar.aria.activeColor': '当前颜色 {color}',
    'toolbar.spotlight.size': '尺寸',
    'toolbar.spotlight.aria': '聚光尺寸，当前 {n} 像素',

    'trust.cap.same-origin-storage.title': '同源存储',
    'trust.cap.same-origin-storage.desc':
      '读写本站作用域内的 Cookie、localStorage 与 IndexedDB，并与同源标签页共享状态。',
    'trust.cap.broadcast-channel.title': '跨标签同步',
    'trust.cap.broadcast-channel.desc':
      '在标签页之间收发 BroadcastChannel 消息（需要同源脚本权限）。',
    'trust.cap.window-open.title': '打开新浏览器窗口',
    'trust.cap.window-open.desc':
      '弹出新的浏览器窗口或标签页（用于演讲者/观众分屏、外部预览或交接）。',

    'footer.local': '本地运行 · 无服务端',
    'footer.site': 'slidestage.dev',

    'update.body': 'SlideStage Lite 有新版本 {version} 可下载。',
    'update.cta.install': '安装更新',
    'update.cta.retry': '重试',
    'update.dismiss': '不再提醒此版本',
    'update.progress.body': '正在下载 SlideStage Lite {version}…',
    'update.progress.detail': '{downloaded} / {total}',
    'update.progress.detailUnknown': '已下载 {downloaded}',
    'update.installing': '正在安装更新…请勿退出应用。',
    'update.restarting': '更新已安装，正在重新启动 SlideStage Lite。',
    'update.error': '更新失败：{message}',

    'menu.checkUpdate.upToDate.title': '已是最新版本',
    'menu.checkUpdate.upToDate.body':
      'SlideStage Lite 已是最新版本。\n当前版本：v{version}。',
    'menu.checkUpdate.available.title': '有可用更新',
    'menu.checkUpdate.available.body':
      'SlideStage Lite v{version} 可下载，是否立即安装？安装完成后应用会自动重新启动。',
    'menu.checkUpdate.available.install': '立即安装',
    'menu.checkUpdate.available.later': '稍后',
    'menu.checkUpdate.error.title': '更新检查失败',
    'menu.checkUpdate.error.body': '无法检查更新：{message}',
    'menu.checkUpdate.installError.title': '更新失败',
    'menu.checkUpdate.installError.body': '更新无法完成：{message}',
  },
};

/**
 * Look up a translated message. Falls back to the default locale, then to
 * the key itself, so a missing translation never crashes the SPA.
 */
export function translate(locale: Locale, key: string): string {
  return messages[locale]?.[key] ?? messages[DEFAULT_LOCALE][key] ?? key;
}

/**
 * Interpolate `{name}` placeholders. Unknown placeholders are kept as-is so
 * the missing variable is visible during development.
 */
export function format(template: string, vars?: Readonly<Record<string, string | number>>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}
