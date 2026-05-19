#!/usr/bin/env node
/**
 * Stand-alone CLI for the offline mirror pass.
 *
 * Reads an existing `.stage` package, runs the mirror over it, writes a
 * fresh `.stage` (and optional report) to disk. Wraps the same core
 * mirror module the GUI uses; the only thing the CLI adds is file I/O, the
 * Node `fetch` fetcher, and a progress printer.
 *
 * Usage:
 *   pnpm mirror <input.stage> --out <output.stage> [options]
 *
 * Options:
 *   --out <file>             Destination .stage path (required).
 *   --max-asset-bytes <n>    Per-asset size cap (default 50 MiB).
 *   --max-total-bytes <n>    Total download budget (default 500 MiB).
 *   --include-scripts        Mirror <script src="https://..."> as well.
 *   --include-iframes        Mirror <iframe src="https://..."> as well.
 *   --allowed-host <h>       Repeatable allow-list (host suffix match).
 *   --blocked-host <h>       Repeatable deny-list.
 *   --timeout-ms <n>         Per-asset HTTP timeout (default 30000).
 *   --user-agent <ua>        Override User-Agent header.
 *   --report <path>          Write a Markdown report next to the output.
 *   --no-report              Suppress the auto-emitted Markdown report.
 *   --verbose                Print every fetch / skip line.
 *   --help / -h              Show this message and exit.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import {
  createNetworkFetcher,
  mirrorExternalAssets,
  packStage,
  type MirrorPolicy,
  type MirrorProgress,
  type MirrorResult,
} from '../src/converter/index.ts';
import { parseManifest } from '../src/deck/manifestSchema.ts';
import type { Manifest, ManifestOfflineSkippedUrl } from '../src/deck/types.ts';

interface CliArgs {
  source?: string;
  out?: string;
  policy: MirrorPolicy;
  timeoutMs?: number;
  userAgent?: string;
  reportPath?: string;
  reportExplicit: boolean;
  noReport: boolean;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    policy: {},
    reportExplicit: false,
    noReport: false,
    verbose: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--max-asset-bytes':
        args.policy.maxAssetBytes = Number(argv[++i]);
        break;
      case '--max-total-bytes':
        args.policy.maxTotalBytes = Number(argv[++i]);
        break;
      case '--include-scripts':
        args.policy.includeScripts = true;
        break;
      case '--include-iframes':
        args.policy.includeIframes = true;
        break;
      case '--allowed-host': {
        const host = argv[++i];
        args.policy.allowedHosts = [...(args.policy.allowedHosts ?? []), host];
        break;
      }
      case '--blocked-host': {
        const host = argv[++i];
        args.policy.blockedHosts = [...(args.policy.blockedHosts ?? []), host];
        break;
      }
      case '--timeout-ms':
        args.timeoutMs = Number(argv[++i]);
        break;
      case '--user-agent':
        args.userAgent = argv[++i];
        break;
      case '--report':
        args.reportPath = argv[++i];
        args.reportExplicit = true;
        break;
      case '--no-report':
        args.noReport = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      default:
        if (token.startsWith('--')) {
          throw new Error(`Unknown flag: ${token}`);
        }
        positional.push(token);
    }
  }
  args.source = positional[0];
  return args;
}

function printUsage(): void {
  process.stdout.write(
    `slidestage-mirror — pre-download external assets into a .stage

Usage:
  pnpm mirror <input.stage> --out <output.stage> [options]

Options:
  --out <file>            Destination .stage path (required).
  --max-asset-bytes <n>   Per-asset size cap (default 50 MiB).
  --max-total-bytes <n>   Total download budget (default 500 MiB).
  --include-scripts       Mirror <script src="https://..."> as well.
  --include-iframes       Mirror <iframe src="https://..."> as well.
  --allowed-host <h>      Repeatable allow-list (host suffix match).
  --blocked-host <h>      Repeatable deny-list.
  --timeout-ms <n>        Per-asset HTTP timeout (default 30000).
  --user-agent <ua>       Override User-Agent header.
  --report <path>         Write a Markdown report next to the output.
  --no-report             Suppress the auto-emitted Markdown report.
  --verbose               Print every fetch / skip line.

Exit codes:
  0 success (offline.ready may still be false)
  4 generic error (bad args / IO / manifest / fetcher)
`,
  );
}

function defaultReportPath(outPath: string): string {
  const base = outPath.replace(/\.stage$/i, '');
  return `${base}-mirror-report.md`;
}

function renderMirrorReport(source: string, out: string, result: MirrorResult): string {
  const skipped = result.offline.skippedUrls
    .map((s: ManifestOfflineSkippedUrl) => `- \`${s.url}\` — ${s.reason}${s.detail ? ` (${s.detail})` : ''}`)
    .join('\n');
  const mirrored = result.offline.mirroredAssets
    .map((a) => `- \`${a.path}\` ← \`${a.originalUrl}\` (${(a.bytes / 1024).toFixed(1)} KiB · ${a.contentType})`)
    .join('\n');
  return `# slidestage offline mirror report

- **Source**: \`${source}\`
- **Output**: \`${out}\`
- **Generated at**: ${result.offline.mirroredAt}
- **Ready**: ${result.offline.ready ? 'yes (no skipped URLs)' : 'no (partial mirror)'}
- **Mirrored**: ${result.stats.mirrored} assets (${(result.stats.bytesDownloaded / 1024 / 1024).toFixed(2)} MiB)
- **Skipped**: ${result.stats.skipped}

## Mirrored assets

${mirrored || '_none_'}

## Skipped URLs

${skipped || '_none_'}
`;
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[mirror] ${(error as Error).message}\n\n`);
    printUsage();
    process.exit(4);
  }

  if (args.help || !args.source) {
    printUsage();
    process.exit(args.help ? 0 : 4);
  }

  if (!args.out) {
    process.stderr.write('[mirror] --out is required.\n\n');
    printUsage();
    process.exit(4);
  }

  const sourcePath = resolve(args.source);
  try {
    await stat(sourcePath);
  } catch (error) {
    process.stderr.write(`[mirror] cannot read source: ${(error as Error).message}\n`);
    process.exit(4);
  }

  const bytes = await readFile(sourcePath);
  let rawEntries: Record<string, Uint8Array>;
  try {
    rawEntries = unzipSync(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error) {
    process.stderr.write(`[mirror] not a valid .stage zip: ${(error as Error).message}\n`);
    process.exit(4);
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, bytes_] of Object.entries(rawEntries)) {
    if (name.endsWith('/')) continue;
    entries.set(name.replace(/\\/g, '/'), bytes_);
  }

  if (!entries.has('manifest.json')) {
    process.stderr.write('[mirror] manifest.json is missing from the package root.\n');
    process.exit(4);
  }
  const manifestBytes = entries.get('manifest.json')!;

  let manifest: Manifest;
  try {
    manifest = parseManifest(JSON.parse(new TextDecoder('utf-8').decode(manifestBytes)));
  } catch (error) {
    process.stderr.write(`[mirror] manifest.json failed validation: ${(error as Error).message}\n`);
    process.exit(4);
  }

  const fetcher = createNetworkFetcher({
    timeoutMs: args.timeoutMs,
    headers: args.userAgent ? { 'user-agent': args.userAgent } : undefined,
  });

  const result = await mirrorExternalAssets(
    { entries, manifest },
    {
      fetcher,
      policy: args.policy,
      onProgress: (p: MirrorProgress) => {
        if (!args.verbose) return;
        process.stderr.write(
          `[mirror] ${p.phase} ${p.done}/${p.queued} (${(p.bytesDownloaded / 1024 / 1024).toFixed(2)} MiB) ${p.currentUrl ?? ''}\n`,
        );
      },
    },
  );

  const outPath = resolve(args.out);
  await mkdir(dirname(outPath), { recursive: true });

  const zipBytes = packStage(result.manifest, result.entries);
  await writeFile(outPath, zipBytes);

  const wantReport = !args.noReport;
  let reportPath: string | undefined;
  if (wantReport) {
    const target = args.reportPath ?? defaultReportPath(outPath);
    reportPath = resolve(target);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, renderMirrorReport(sourcePath, outPath, result), 'utf-8');
  }

  process.stdout.write(`${outPath}\n`);
  if (reportPath) process.stdout.write(`${reportPath}\n`);

  if (args.verbose) {
    process.stderr.write(
      `[mirror] done · ready=${result.offline.ready} · mirrored=${result.stats.mirrored} · skipped=${result.stats.skipped} · bytes=${(result.stats.bytesDownloaded / 1024 / 1024).toFixed(2)} MiB\n`,
    );
  }
  // Avoid surfacing partial-mirror results as exit failure: spec calls
  // `offline.ready=false` legal.
  process.exit(0);
}

void main();

// `basename` is referenced for symmetry with bin/convert.ts and to keep the
// linter happy when --report is omitted — silence the unused warning.
void basename;
