/**
 * ドラッグ&ドロップされた DataTransfer から File を集める。
 * フォルダがドロップされた場合は再帰的に辿る（webkitGetAsEntry 対応ブラウザ）。
 *
 * 注意: DataTransfer.items はイベントハンドラを抜けると空になるため、
 * 最初の await より前に同期的にエントリを取り出しておく必要がある。
 */
export async function collectFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const fallback = Array.from(dt.files ?? []);

  const entries: FileSystemEntry[] = [];
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const entry =
        typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
  }
  if (entries.length === 0) return fallback;

  const out: File[] = [];
  for (const entry of entries) await walkEntry(entry, out);
  // エントリは取れたが file() が全滅した場合は素の files にフォールバック
  return out.length > 0 ? out : fallback;
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    try {
      out.push(await readEntryFile(entry as FileSystemFileEntry));
    } catch {
      // 読めないエントリはスキップ
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries は 1 回で全件を返さない（Chrome は 100 件ずつ）ので、空になるまで繰り返す
    for (;;) {
      const batch = await readDirectoryBatch(reader);
      if (batch.length === 0) break;
      for (const e of batch) await walkEntry(e, out);
    }
  }
}
