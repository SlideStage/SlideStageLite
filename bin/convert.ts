#!/usr/bin/env node
import type { Stats } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { exit } from 'node:process';
import {
  convertFolderSource,
  convertSource,
  shouldSkipFolderPath,
  type ConvertMode,
  type ConvertOptions,
} from '../src/converter/index.ts';
import { DeckLoadError, type DeckLoadErrorCode } from '../src/deck/types.ts';

interface ParsedArgs {
  command: 'pack' | null;
  source?: string;
  out?: string;
  mode?: ConvertMode;
  report?: string;
  reportExplicit: boolean;
  noReport: boolean;
  repack: boolean;
  strict: boolean;
  verbose: boolean;
  manifest: {
    id?: string;
    version?: string;
    title?: string;
    width?: number;
    height?: number;
  };
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: null,
    reportExplicit: false,
    noReport: false,
    repack: false,
    strict: false,
    verbose: false,
    manifest: {},
    help: false,
  };

  if (argv.length === 0) {
    args.help = true;
    return args;
  }

  if (argv[0] === 'pack') {
    args.command = 'pack';
    argv = argv.slice(1);
  }

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
      case '--mode':
        args.mode = argv[++i] as ConvertMode;
        break;
      case '--report':
        args.report = argv[++i];
        args.reportExplicit = true;
        break;
      case '--no-report':
        args.noReport = true;
        break;
      case '--repack':
        args.repack = true;
        break;
      case '--strict':
        args.strict = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--id':
        args.manifest.id = argv[++i];
        break;
      case '--version':
        args.manifest.version = argv[++i];
        break;
      case '--title':
        args.manifest.title = argv[++i];
        break;
      case '--width':
        args.manifest.width = Number(argv[++i]);
        break;
      case '--height':
        args.manifest.height = Number(argv[++i]);
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
    `slidestage-convert — pack HTML decks into .stage

Usage:
  slidestage-convert pack <source> --out <file.stage> [options]

<source> may be:
  • A .html / .htm file (single-page deck).
  • A .zip or .stage archive (already-packaged deck).
  • A directory tree (recursively walked; .git / node_modules / OS noise
    are skipped by the shared folder filter).

Required:
  --out <file>           Destination .stage path.

Modes:
  --mode <split|wrap|passthrough|single>
                         Override the default mode for the detected source.
  --repack               Allow repacking a slidestage input (otherwise only
                         passthrough is permitted).

Manifest overrides:
  --id <string>          Override manifest id.
  --version <semver>     Override manifest version (default 0.0.0 for sniffed sources).
  --title <string>       Override manifest title.
  --width <px>           Override slide width (default 1920).
  --height <px>          Override slide height (default 1080).

Diagnostics:
  --report <path>        Write a Markdown report to the given path.
                         Defaults to <out-basename>-report.md when omitted.
  --no-report            Disable the automatic report.
  --strict               Treat warnings as errors.
  --verbose              Log every rewrite and asset copy.

Exit codes:
  0  success
  1  E_NO_ENTRY_FOUND
  2  E_AMBIGUOUS_PACKAGE
  3  E_NOT_ZIP
  4  Other (printed message)
`,
  );
}

const exitCodeByErrorCode: Partial<Record<DeckLoadErrorCode, number>> = {
  E_NO_ENTRY_FOUND: 1,
  E_AMBIGUOUS_PACKAGE: 2,
  E_NOT_ZIP: 3,
};

function defaultReportPath(outPath: string): string {
  const base = outPath.replace(/\.stage$/i, '');
  return `${base}-report.md`;
}

async function readSingleFileSource(
  sourcePath: string,
  sourceStat: Stats,
) {
  const sourceBytes = await readFile(sourcePath);
  return {
    bytes: new Uint8Array(
      sourceBytes.buffer,
      sourceBytes.byteOffset,
      sourceBytes.byteLength,
    ),
    name: basename(sourcePath),
    lastModified: Number(sourceStat.mtimeMs),
  };
}

async function readFolderEntries(
  root: string,
): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();

  async function walk(dirPath: string): Promise<void> {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const absolute = join(dirPath, dirent.name);
      const rel = relative(root, absolute).split(/[\\/]/g).join('/');
      if (shouldSkipFolderPath(rel)) continue;
      if (dirent.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!dirent.isFile()) continue;
      const bytes = await readFile(absolute);
      entries.set(
        rel,
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
    }
  }

  await walk(root);
  return entries;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[converter] ${(error as Error).message}\n\n`);
    printUsage();
    exit(4);
  }

  if (args.help || args.command !== 'pack') {
    printUsage();
    exit(args.help ? 0 : 4);
  }

  if (!args.source) {
    process.stderr.write('[converter] missing <source> positional argument.\n\n');
    printUsage();
    exit(4);
  }

  if (!args.out) {
    process.stderr.write('[converter] --out is required.\n\n');
    printUsage();
    exit(4);
  }

  const sourcePath = resolve(args.source);
  let sourceStat: Stats;
  try {
    sourceStat = (await stat(sourcePath)) as Stats;
  } catch (error) {
    process.stderr.write(`[converter] cannot read source: ${(error as Error).message}\n`);
    exit(4);
  }

  const wantReport = !args.noReport;
  const options: ConvertOptions = {
    mode: args.mode,
    repackStage: args.repack,
    strict: args.strict,
    report: wantReport,
    manifestOverrides: args.manifest,
  };

  try {
    const isDirectory = sourceStat.isDirectory();
    const result = isDirectory
      ? await convertFolderSource(
          {
            entries: await readFolderEntries(sourcePath),
            name: basename(sourcePath),
            lastModified: Number(sourceStat.mtimeMs),
          },
          options,
        )
      : await convertSource(
          await readSingleFileSource(sourcePath, sourceStat),
          options,
        );

    const outPath = resolve(args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, result.stage);

    let reportPath: string | undefined;
    if (wantReport && result.reportMarkdown) {
      const target = args.report ?? defaultReportPath(outPath);
      reportPath = resolve(target);
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, result.reportMarkdown, 'utf-8');
    }

    if (args.verbose) {
      process.stderr.write(
        `[converter] wrote ${outPath} (${result.stage.byteLength} bytes, ${result.manifest.totalSlides} slides)\n`,
      );
      if (reportPath) {
        process.stderr.write(`[converter] wrote ${reportPath}\n`);
      }
    } else {
      process.stdout.write(`${outPath}\n`);
      if (reportPath) {
        process.stdout.write(`${reportPath}\n`);
      }
    }
  } catch (error) {
    if (error instanceof DeckLoadError) {
      const code = exitCodeByErrorCode[error.code] ?? 4;
      process.stderr.write(`[converter] ${error.code}: ${error.message}\n`);
      exit(code);
    }
    const message = (error as Error).message ?? String(error);
    const stripped = message.startsWith('[converter] ') ? message.slice('[converter] '.length) : message;
    process.stderr.write(`[converter] ${stripped}\n`);
    exit(4);
  }
}

void main();
