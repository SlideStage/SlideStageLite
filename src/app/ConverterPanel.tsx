import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { Download, Play, X } from 'lucide-react';
import {
  convertFolderSource,
  convertSource,
  createNetworkFetcher,
  type ConvertMode,
  type ConvertResult,
  type MirrorProgress,
} from '../converter';
import { DeckLoadError } from '../deck/types';
import { useI18n } from '../i18n/I18nProvider';
import { readFolderFromDataTransfer, readFolderFromFileList, type FolderEntries } from './readFolderInput';

type ModeChoice = 'auto' | ConvertMode;

interface ModeOption {
  value: ModeChoice;
  /** Display label; non-`auto` keeps the raw enum value to mirror the CLI. */
  label: string;
  /** i18n key for the per-mode help line. */
  helpKey: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'auto', label: '', helpKey: 'converter.mode.auto.help' },
  { value: 'split', label: 'split', helpKey: 'converter.mode.split.help' },
  { value: 'wrap', label: 'wrap', helpKey: 'converter.mode.wrap.help' },
  { value: 'single', label: 'single', helpKey: 'converter.mode.single.help' },
  {
    value: 'passthrough',
    label: 'passthrough',
    helpKey: 'converter.mode.passthrough.help',
  },
];

type Selection =
  | { kind: 'file'; file: File }
  | { kind: 'folder'; folder: FolderEntries };

interface ConverterPanelProps {
  /** Called once a converted .hcslides File is ready to feed to loadDeck. */
  onConvertedReady: (file: File) => Promise<void>;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function outputNameFor(selection: Selection): string {
  if (selection.kind === 'file') {
    const base = selection.file.name.replace(/\.(html?|zip|hcslides)$/i, '');
    return `${base || 'converted'}.hcslides`;
  }
  const base = selection.folder.name.replace(/\W+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'converted'}.hcslides`;
}

function summaryFor(selection: Selection): string {
  if (selection.kind === 'file') {
    return `${selection.file.name} · ${formatSize(selection.file.size)}`;
  }
  const { folder } = selection;
  return `${folder.name}/ · ${folder.entries.size} files · ${formatSize(folder.totalBytes)}`;
}

export function ConverterPanel({ onConvertedReady, onClose }: ConverterPanelProps) {
  const { t, tFormat } = useI18n();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mode, setMode] = useState<ModeChoice>('auto');
  const [status, setStatus] = useState<'idle' | 'converting' | 'ready'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [mirrorProgress, setMirrorProgress] = useState<MirrorProgress | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const localizedModes = useMemo(
    () =>
      MODE_OPTIONS.map((m) => ({
        ...m,
        displayLabel: m.value === 'auto' ? t('converter.mode.auto.label') : m.label,
        help: t(m.helpKey),
      })),
    [t],
  );

  useEffect(() => () => {
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
  }, []);

  const selectionSummary = useMemo(() => (selection ? summaryFor(selection) : null), [selection]);

  const replaceSelection = useCallback((next: Selection | null) => {
    setSelection(next);
    setStatus('idle');
    setError(null);
    setResult(null);
    setMirrorProgress(null);
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    replaceSelection(next ? { kind: 'file', file: next } : null);
  };

  const handleFolderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      replaceSelection(null);
      return;
    }
    try {
      const folder = await readFolderFromFileList(files);
      replaceSelection({ kind: 'folder', folder });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('converter.errors.folderRead'));
    } finally {
      event.target.value = '';
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const items = event.dataTransfer.items;
    try {
      if (items && items.length > 0) {
        const folder = await readFolderFromDataTransfer(items);
        if (folder) {
          replaceSelection({ kind: 'folder', folder });
          return;
        }
      }
      const file = event.dataTransfer.files?.[0];
      if (file) {
        replaceSelection({ kind: 'file', file });
        return;
      }
      setError(t('converter.errors.noDrop'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('converter.errors.dropRead'));
    }
  };

  const runConvert = async (): Promise<ConvertResult | null> => {
    if (!selection) return null;
    setStatus('converting');
    setError(null);
    setMirrorProgress(null);
    try {
      const opts = {
        mode: mode === 'auto' ? undefined : (mode as ConvertMode),
        report: true,
        repackHcslides: mirrorEnabled,
        ...(mirrorEnabled
          ? {
              mirror: {
                fetcher: createNetworkFetcher(),
                onProgress: (progress: MirrorProgress) => setMirrorProgress(progress),
              },
            }
          : {}),
      };
      let out: ConvertResult;
      if (selection.kind === 'file') {
        const bytes = new Uint8Array(await selection.file.arrayBuffer());
        out = await convertSource(
          { bytes, name: selection.file.name, lastModified: selection.file.lastModified },
          opts,
        );
      } else {
        out = await convertFolderSource(
          {
            entries: selection.folder.entries,
            name: selection.folder.name,
            lastModified: Date.now(),
          },
          opts,
        );
      }
      setResult(out);
      setStatus('ready');
      return out;
    } catch (convertError) {
      const message =
        convertError instanceof DeckLoadError
          ? `${convertError.code}: ${convertError.message}`
          : convertError instanceof Error
            ? convertError.message.replace(/^\[converter\]\s*/, '')
            : t('converter.errors.convert');
      setError(message);
      setStatus('idle');
      return null;
    }
  };

  const handleConvertAndLoad = async () => {
    const out = await runConvert();
    if (!out || !selection) return;
    const buffer = out.hcslides.buffer.slice(
      out.hcslides.byteOffset,
      out.hcslides.byteOffset + out.hcslides.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    const outName = outputNameFor(selection);
    const outFile = new File([blob], outName, {
      type: 'application/zip',
      lastModified: Date.now(),
    });
    try {
      await onConvertedReady(outFile);
    } catch (loadError) {
      const message =
        loadError instanceof DeckLoadError
          ? `${loadError.code}: ${loadError.message}`
          : loadError instanceof Error
            ? loadError.message
            : t('converter.errors.loadAfter');
      setError(message);
    }
  };

  const handleConvertAndDownload = async () => {
    const out = await runConvert();
    if (!out || !selection) return;
    const buffer = out.hcslides.buffer.slice(
      out.hcslides.byteOffset,
      out.hcslides.byteOffset + out.hcslides.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'application/zip' });
    if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    const url = URL.createObjectURL(blob);
    downloadUrlRef.current = url;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = outputNameFor(selection);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const acceptingMode = localizedModes.find((m) => m.value === mode)!;

  return (
    <section className="converter-panel" aria-labelledby="converter-title">
      <header className="converter-panel__header">
        <h2 id="converter-title">{t('converter.title')}</h2>
        <button
          type="button"
          className="btn ghost icon-only"
          onClick={onClose}
          aria-label={t('converter.close')}
          data-testid="converter-close"
        >
          <X className="btn-icon" size={16} aria-hidden />
        </button>
      </header>
      <p className="converter-panel__intro">
        {t('converter.intro.before')} <code>html-ppt-skill</code>,{' '}
        <code>huashu-design</code>
        {t('converter.intro.mid')} <code>.hcslides</code>
        {t('converter.intro.after')}
      </p>

      <div className="converter-panel__steps">
        <div className="converter-step">
          <span className="converter-step-label">
            <span className="converter-step-number" aria-hidden>
              1
            </span>
            {t('converter.step.source')}
          </span>
          <div
            className={`converter-panel__drop${isDragOver ? ' is-drag-over' : ''}`}
            data-testid="converter-drop"
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <p className="converter-panel__drop-headline">
              {isDragOver
                ? t('converter.drop.dragging')
                : t('converter.drop.idle')}
            </p>
            <p className="converter-panel__drop-help">
              {t('converter.drop.help')}
            </p>
            <div className="converter-panel__drop-actions">
              <label className="btn ghost file-button">
                <span>
                  {selection
                    ? t('converter.drop.pickAnother')
                    : t('converter.drop.pickFile')}
                </span>
                <input
                  type="file"
                  accept=".html,.htm,.zip,.hcslides,application/zip,text/html"
                  onChange={handleFileChange}
                  data-testid="converter-file-input"
                />
              </label>
              <label className="btn ghost file-button">
                <span>{t('converter.drop.pickFolder')}</span>
                <input
                  type="file"
                  data-testid="converter-folder-input"
                  onChange={handleFolderChange}
                  {...({
                    webkitdirectory: '',
                    directory: '',
                    multiple: true,
                  } as Record<string, unknown>)}
                />
              </label>
            </div>
            {selectionSummary ? (
              <p
                className="converter-panel__filename"
                data-testid="converter-selection"
              >
                {selectionSummary}
              </p>
            ) : null}
          </div>
        </div>

        <div className="converter-step">
          <span className="converter-step-label">
            <span className="converter-step-number" aria-hidden>
              2
            </span>
            {t('converter.step.mode')}
          </span>
          <label className="converter-panel__field">
            <span>{t('converter.field.mode')}</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as ModeChoice)}
            >
              {localizedModes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.displayLabel}
                </option>
              ))}
            </select>
          </label>
          <p className="converter-panel__field-help">{acceptingMode.help}</p>
        </div>

        <div className="converter-step">
          <span className="converter-step-label">
            <span className="converter-step-number" aria-hidden>
              3
            </span>
            {t('converter.step.mirror')}
          </span>
          <label className="converter-panel__checkbox">
            <input
              type="checkbox"
              checked={mirrorEnabled}
              onChange={(event) => setMirrorEnabled(event.target.checked)}
              disabled={status === 'converting'}
              data-testid="converter-mirror-toggle"
            />
            <span>{t('converter.mirror.label')}</span>
          </label>
          <p className="converter-panel__field-help">{t('converter.mirror.help')}</p>
          {mirrorEnabled && mirrorProgress ? (
            <p
              className="converter-panel__field-help"
              data-testid="converter-mirror-progress"
            >
              {tFormat('converter.mirror.progress', {
                phase: mirrorProgress.phase,
                done: mirrorProgress.done,
                queued: mirrorProgress.queued,
                mib: (mirrorProgress.bytesDownloaded / 1024 / 1024).toFixed(2),
              })}
            </p>
          ) : null}
        </div>

        <div className="converter-step">
          <span className="converter-step-label">
            <span className="converter-step-number" aria-hidden>
              4
            </span>
            {t('converter.step.output')}
          </span>
          <div className="converter-panel__actions">
            <button
              type="button"
              className="btn primary"
              disabled={!selection || status === 'converting'}
              onClick={handleConvertAndLoad}
              data-testid="converter-load"
            >
              <Play className="btn-icon" size={14} aria-hidden />
              {status === 'converting'
                ? t('converter.actions.loading')
                : t('converter.actions.load')}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!selection || status === 'converting'}
              onClick={handleConvertAndDownload}
              data-testid="converter-download"
            >
              <Download className="btn-icon" size={14} aria-hidden />
              {t('converter.actions.download')}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="alert error" role="alert" data-testid="converter-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          className="converter-panel__result"
          data-testid="converter-result"
        >
          <p>
            {tFormat('converter.result.summary', {
              count: result.report.totalSlides,
              label:
                result.report.totalSlides === 1
                  ? t('converter.result.slide.singular')
                  : t('converter.result.slide.plural'),
              mode: result.report.mode,
              source: result.report.sourceKind,
              warnings:
                result.report.warnings.length > 0
                  ? tFormat('converter.result.warnings.some', {
                      n: result.report.warnings.length,
                      label:
                        result.report.warnings.length === 1
                          ? t('converter.result.warning.singular')
                          : t('converter.result.warning.plural'),
                    })
                  : t('converter.result.warnings.none'),
            })}
          </p>
          {result.mirror ? (
            <p data-testid="converter-mirror-summary">
              {tFormat(
                result.mirror.offline.ready
                  ? 'converter.mirror.summary.ready'
                  : 'converter.mirror.summary.partial',
                {
                  mirrored: result.mirror.stats.mirrored,
                  skipped: result.mirror.stats.skipped,
                  mib: (result.mirror.stats.bytesDownloaded / 1024 / 1024).toFixed(2),
                },
              )}
            </p>
          ) : null}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setShowReport((value) => !value)}
          >
            {showReport
              ? t('converter.result.toggle.hide')
              : t('converter.result.toggle.show')}
          </button>
          {showReport && result.reportMarkdown ? (
            <pre className="converter-panel__report">
              {result.reportMarkdown}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
