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
 *   --allow-private-network  Allow private/loopback/link-local targets (unsafe).
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
import {
  createNetworkFetcher,
  mirrorExternalAssets,
  packStage,
  safeUnzipSync,
  type MirrorPolicy,
  type MirrorProgress,
  type MirrorResult,
} from '@slidestage/core/converter';
import { parseManifest } from '@slidestage/core/deck/manifestSchema';
import { normalizePackagePath } from '@slidestage/core/deck/pathSafety';
import type { Manifest, ManifestOfflineSkippedUrl } from '@slidestage/core/deck/types';

// Decompression budgets, kept in lockstep with the loader / converter so the
// CLI rejects the same decompression bombs the runtime does.
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;

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
      case '--allow-private-network':
        args.policy.allowPrivateNetwork = true;
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
  --allow-private-network Allow private/loopback/link-local targets (unsafe).
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
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    process.stderr.write(
      `[mirror] source exceeds the package size limit (${bytes.byteLength} > ${MAX_PACKAGE_BYTES}).\n`,
    );
    process.exit(4);
  }
  let rawEntries: Record<string, Uint8Array>;
  try {
    // Budget-aware unzip: reject decompression bombs before materializing the
    // archive (CWE-409 / CWE-400) so the CLI cannot be OOM'd by a tiny input.
    rawEntries = safeUnzipSync(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      maxEntryBytes: MAX_ENTRY_BYTES,
      maxTotalBytes: MAX_DECOMPRESSED_BYTES,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'E_TOO_LARGE') {
      process.stderr.write(`[mirror] ${(error as Error).message}\n`);
    } else {
      process.stderr.write(`[mirror] not a valid .stage zip: ${(error as Error).message}\n`);
    }
    process.exit(4);
  }

  const entries = new Map<string, Uint8Array>();
  try {
    for (const [name, bytes_] of Object.entries(rawEntries)) {
      if (name.endsWith('/')) continue;
      // Normalize + validate every member name (CWE-22 / Zip Slip). Without
      // this the CLI would "launder" a malicious archive — copying raw
      // entry names like `../../evil` straight into a freshly re-signed
      // `.stage` that downstream extractors honor. `normalizePackagePath`
      // rewrites `\` to `/`, collapses `.`/empty segments, and throws
      // `E_PATH_TRAVERSAL` on absolute / `..` / NUL names.
      entries.set(normalizePackagePath(name), bytes_);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'E_PATH_TRAVERSAL') {
      process.stderr.write(`[mirror] refusing unsafe archive member: ${(error as Error).message}\n`);
    } else {
      process.stderr.write(`[mirror] failed to read archive entries: ${(error as Error).message}\n`);
    }
    process.exit(4);
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
    // Re-validate redirect hops with the same private-network policy.
    policy: args.policy,
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
