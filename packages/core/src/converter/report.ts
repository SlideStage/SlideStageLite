import type { SniffKind } from './sniffer';

export type ConvertMode = 'split' | 'wrap' | 'passthrough' | 'single';

export type ConvertWarning =
  | { kind: 'router-missing-entry'; file: string }
  | { kind: 'runtime-dropped'; reason: string }
  | { kind: 'external-base'; href: string }
  | { kind: 'fallback-mode'; from: ConvertMode; to: ConvertMode; reason: string }
  | {
      kind: 'mirror-skipped';
      url: string;
      reason:
        | 'unreachable'
        | 'blocked-by-policy'
        | 'too-large'
        | 'unsupported-scheme'
        | 'budget-exhausted'
        | 'manual-skip';
      detail?: string;
    }
  | { kind: 'note'; message: string };

export interface ConvertedSlideEntry {
  index: number;
  id: string;
  label: string;
  file: string;
  sourceRange?: string;
}

export interface ConvertReport {
  sourceName: string;
  sourceKind: SniffKind;
  mode: ConvertMode;
  manifestId: string;
  manifestTitle: string;
  totalSlides: number;
  slides: ConvertedSlideEntry[];
  assetsCopied: string[];
  warnings: ConvertWarning[];
  generatedAt: string;
}

export function emptyReport(sourceName: string, sourceKind: SniffKind, mode: ConvertMode): ConvertReport {
  return {
    sourceName,
    sourceKind,
    mode,
    manifestId: '',
    manifestTitle: '',
    totalSlides: 0,
    slides: [],
    assetsCopied: [],
    warnings: [],
    generatedAt: new Date().toISOString(),
  };
}

function formatWarning(warning: ConvertWarning): string {
  switch (warning.kind) {
    case 'router-missing-entry':
      return `- **Router entry skipped**: \`${warning.file}\` was referenced by \`window.DECK_MANIFEST\` but is not present in the source.`;
    case 'runtime-dropped':
      return `- **Runtime stripped**: ${warning.reason}`;
    case 'external-base':
      return `- **External \`<base href>\`**: \`${warning.href}\` left untouched; sandboxed subresource loads against this base will fail.`;
    case 'fallback-mode':
      return `- **Mode fallback**: requested \`${warning.from}\` but converted as \`${warning.to}\` because ${warning.reason}.`;
    case 'mirror-skipped':
      return `- **Mirror skipped**: \`${warning.url}\` (${warning.reason}${warning.detail ? `: ${warning.detail}` : ''}).`;
    case 'note':
      return `- ${warning.message}`;
  }
}

export function renderReportMarkdown(report: ConvertReport): string {
  const slideLines = report.slides
    .map(
      (slide) =>
        `| ${slide.index} | \`${slide.id}\` | ${slide.label} | \`${slide.file}\`${
          slide.sourceRange ? ` | ${slide.sourceRange}` : ' |'
        }`,
    )
    .join('\n');

  const slideTable = report.slides.length
    ? `\n## Slides\n\n| # | id | label | file |\n| --- | --- | --- | --- |\n${slideLines}\n`
    : '';

  const assetList = report.assetsCopied.length
    ? `\n## Assets copied\n\n${report.assetsCopied.map((path) => `- \`${path}\``).join('\n')}\n`
    : '';

  const warningSection = report.warnings.length
    ? `\n## Warnings\n\n${report.warnings.map(formatWarning).join('\n')}\n`
    : '\n## Warnings\n\nNone.\n';

  return `# SlideStage Converter Report

- **Source**: \`${report.sourceName}\`
- **Detected kind**: \`${report.sourceKind}\`
- **Mode**: \`${report.mode}\`
- **Manifest id**: \`${report.manifestId}\`
- **Manifest title**: ${report.manifestTitle}
- **Total slides**: ${report.totalSlides}
- **Generated at**: ${report.generatedAt}
${slideTable}${assetList}${warningSection}`;
}
