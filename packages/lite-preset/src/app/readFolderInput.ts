import { shouldSkipFolderPath } from '@slidestage/core/converter';

export interface FolderEntries {
  name: string;
  entries: Map<string, Uint8Array>;
  totalBytes: number;
}

interface DataTransferItemWithEntry extends DataTransferItem {
  webkitGetAsEntry: () => FileSystemEntry | null;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    onEntries: (entries: ReadonlyArray<FileSystemEntryLike>) => void,
    onError?: (err: unknown) => void,
  ) => void;
}

function fileToBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((buf) => new Uint8Array(buf));
}

function readDirectory(
  dir: FileSystemDirectoryEntryLike,
): Promise<ReadonlyArray<FileSystemEntryLike>> {
  return new Promise((resolveFn, rejectFn) => {
    const collected: FileSystemEntryLike[] = [];
    const reader = dir.createReader();

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolveFn(collected);
            return;
          }
          collected.push(...batch);
          // Per spec, readEntries may return only a subset per call.
          readBatch();
        },
        (err) => rejectFn(err ?? new Error('readEntries failed')),
      );
    };

    readBatch();
  });
}

async function walkEntry(
  entry: FileSystemEntryLike,
  rootPathLen: number,
  out: Map<string, Uint8Array>,
  totals: { bytes: number },
): Promise<void> {
  const fullPath = entry.fullPath ?? `/${entry.name}`;
  const rel = fullPath.length > rootPathLen ? fullPath.slice(rootPathLen + 1) : entry.name;
  const packagePath = rel.replace(/^\/+/, '');
  if (shouldSkipFolderPath(packagePath)) return;

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntryLike;
    const file = await new Promise<File>((resolveFn, rejectFn) =>
      fileEntry.file(resolveFn, (e) => rejectFn(e ?? new Error('file() failed'))),
    );
    const bytes = await fileToBytes(file);
    out.set(packagePath, bytes);
    totals.bytes += bytes.byteLength;
    return;
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntryLike;
    const children = await readDirectory(dirEntry);
    await Promise.all(
      children.map((child) => walkEntry(child, rootPathLen, out, totals)),
    );
  }
}

function rootNameOf(file: File): string {
  // webkitdirectory exposes a `webkitRelativePath` like
  // "folder-name/sub/asset.png". The first segment is the chosen folder.
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const slash = relative.indexOf('/');
  if (slash > 0) return relative.slice(0, slash);
  return 'deck-folder';
}

export async function readFolderFromFileList(files: FileList): Promise<FolderEntries> {
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  if (files.length === 0) {
    throw new Error('No files selected.');
  }
  const name = rootNameOf(files[0]);

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const relative =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = relative.replace(/^\/+/, '');
    if (shouldSkipFolderPath(path)) continue;
    const bytes = await fileToBytes(file);
    entries.set(stripLeadingFolder(path, name), bytes);
    totalBytes += bytes.byteLength;
  }

  if (entries.size === 0) {
    throw new Error('Folder is empty after filtering noise (.git, node_modules, .DS_Store).');
  }

  return { name, entries, totalBytes };
}

function stripLeadingFolder(path: string, folderName: string): string {
  const prefix = `${folderName}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export async function readFolderFromDataTransfer(
  items: DataTransferItemList,
): Promise<FolderEntries | null> {
  const fileEntries: FileSystemEntryLike[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as DataTransferItemWithEntry;
    const getter = item.webkitGetAsEntry;
    if (typeof getter !== 'function') return null;
    const entry = getter.call(item);
    if (!entry) continue;
    fileEntries.push(entry as unknown as FileSystemEntryLike);
  }
  if (fileEntries.length === 0) return null;

  // If the user drops a single file, fall back to the single-file path.
  if (fileEntries.length === 1 && fileEntries[0].isFile && !fileEntries[0].isDirectory) {
    return null;
  }

  const name =
    fileEntries.length === 1 && fileEntries[0].isDirectory
      ? fileEntries[0].name
      : 'dropped-deck';
  const rootPathLen = fileEntries.length === 1 ? (fileEntries[0].fullPath ?? '').length : 0;

  const out = new Map<string, Uint8Array>();
  const totals = { bytes: 0 };
  if (fileEntries.length === 1) {
    const root = fileEntries[0];
    if (root.isFile) {
      // Caller should fall back to file mode.
      return null;
    }
    const dirRoot = root as FileSystemDirectoryEntryLike;
    const children = await readDirectory(dirRoot);
    await Promise.all(children.map((child) => walkEntry(child, rootPathLen, out, totals)));
  } else {
    // Multiple roots keep their top-level names in the package path.
    await Promise.all(
      fileEntries.map((entry) => walkEntry(entry, 0, out, totals)),
    );
  }

  if (out.size === 0) {
    throw new Error('Dropped folder is empty after filtering noise (.git, node_modules, .DS_Store).');
  }

  return { name, entries: out, totalBytes: totals.bytes };
}
