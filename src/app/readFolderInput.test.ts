import { describe, expect, it } from 'vitest';
import { readFolderFromDataTransfer } from '@slidestage/lite-preset/app/readFolderInput';

describe('readFolderFromDataTransfer', () => {
  it('returns paths relative to a single dropped directory root', async () => {
    const file = new File(['<h1>Deck</h1>'], 'index.html', { type: 'text/html' });
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: 'index.html',
      fullPath: '/my-deck/index.html',
      file: (cb: (file: File) => void) => cb(file),
    };
    let didRead = false;
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: 'my-deck',
      fullPath: '/my-deck',
      createReader: () => ({
        readEntries: (cb: (entries: unknown[]) => void) => {
          if (didRead) {
            cb([]);
            return;
          }
          didRead = true;
          cb([fileEntry]);
        },
      }),
    };
    const items = {
      length: 1,
      0: {
        webkitGetAsEntry: () => directoryEntry,
      },
    } as unknown as DataTransferItemList;

    const folder = await readFolderFromDataTransfer(items);

    expect(folder?.name).toBe('my-deck');
    expect(folder?.entries.has('index.html')).toBe(true);
    expect(folder?.entries.has('my-deck/index.html')).toBe(false);
  });
});
