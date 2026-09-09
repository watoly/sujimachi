/**
 * 「どの CSV を対象にしているか」の保存と復元。
 *
 * File ハンドルは保存できないので、ファイル名で対応づける。
 * 同じフォルダを読み込み直せば元の対象範囲を再現できる。
 *
 * 検索カラムは「除外した列」だけを持つ。ほとんどの場合は空になるので
 * ファイルが小さく収まり、また読み込み時に列が増えていた場合は
 * その列が検索対象に入る。黙って検索範囲が狭まるより取りこぼしが少ない。
 */
import type { CsvSource } from '../types';

export const SELECTION_FORMAT = 'sujimachi.selection';
export const SELECTION_VERSION = 1;

export interface SelectionEntry {
  name: string;
  enabled: boolean;
  /** 検索対象から外した列。省略時は全列が対象。 */
  excludedColumns?: string[];
  /** 表示に使う日時カラム。省略時は自動推測のまま。 */
  timestampColumn?: string | null;
}

export interface SelectionFile {
  format: string;
  version: number;
  exportedAt: string;
  /** 保存時のファイル名フィルター */
  nameFilter?: string;
  entries: SelectionEntry[];
}

export function buildSelection(sources: CsvSource[], nameFilter: string): SelectionFile {
  return {
    format: SELECTION_FORMAT,
    version: SELECTION_VERSION,
    exportedAt: new Date().toISOString(),
    nameFilter: nameFilter || undefined,
    entries: sources.map((s) => {
      const selected = new Set(s.searchColumns);
      const excluded = s.headers.filter((h) => !selected.has(h));
      const e: SelectionEntry = { name: s.fileName, enabled: s.enabled };
      if (excluded.length > 0) e.excludedColumns = excluded;
      if (s.timestampColumn) e.timestampColumn = s.timestampColumn;
      return e;
    }),
  };
}

export function serializeSelection(sel: SelectionFile): string {
  return JSON.stringify(sel, null, 2) + '\n';
}

/** 読み込んだ JSON を検証する。壊れていれば理由付きで throw する。 */
export function parseSelection(text: string): SelectionFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON として読めませんでした。');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('中身が空です。');

  const o = raw as Record<string, unknown>;
  if (o.format !== SELECTION_FORMAT) {
    throw new Error('このツールが書き出した選択状態ファイルではありません。');
  }
  if (!Array.isArray(o.entries)) throw new Error('ファイル一覧が含まれていません。');

  const entries: SelectionEntry[] = [];
  for (const item of o.entries) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.name !== 'string' || !e.name) continue;
    entries.push({
      name: e.name,
      enabled: e.enabled !== false,
      excludedColumns: Array.isArray(e.excludedColumns)
        ? e.excludedColumns.filter((c): c is string => typeof c === 'string')
        : undefined,
      timestampColumn: typeof e.timestampColumn === 'string' ? e.timestampColumn : undefined,
    });
  }
  if (entries.length === 0) throw new Error('復元できるファイル情報がありませんでした。');

  return {
    format: SELECTION_FORMAT,
    version: typeof o.version === 'number' ? o.version : SELECTION_VERSION,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    nameFilter: typeof o.nameFilter === 'string' ? o.nameFilter : undefined,
    entries,
  };
}

export interface ApplyResult {
  sources: CsvSource[];
  /** 設定を適用できたファイル数 */
  applied: number;
  /** 設定にあるが読み込まれていないファイル名 */
  missing: string[];
  /** 読み込まれているが設定に無いファイル数（選択は変更しない） */
  untouched: number;
}

/**
 * 保存した選択状態を、いま読み込まれているファイルに当てる。
 *
 * 設定に載っていないファイルは触らない。勝手に外すと、あとから増えたファイルが
 * 黙って調査範囲から抜け落ちるため。件数は呼び出し側で通知する。
 */
export function applySelection(sources: CsvSource[], sel: SelectionFile): ApplyResult {
  const byName = new Map<string, SelectionEntry>();
  for (const e of sel.entries) byName.set(e.name.toLowerCase(), e);

  const used = new Set<string>();
  let applied = 0;
  let untouched = 0;

  const next = sources.map((s) => {
    const key = s.fileName.toLowerCase();
    const e = byName.get(key);
    if (!e) {
      untouched++;
      return s;
    }
    used.add(key);
    applied++;

    const excluded = new Set(e.excludedColumns ?? []);
    const searchColumns =
      excluded.size > 0 ? s.headers.filter((h) => !excluded.has(h)) : [...s.headers];

    // 保存された日時カラムが今のヘッダーに無ければ、自動推測の結果を残す
    const ts =
      e.timestampColumn && s.headers.includes(e.timestampColumn)
        ? e.timestampColumn
        : s.timestampColumn;

    return { ...s, enabled: e.enabled, searchColumns, timestampColumn: ts };
  });

  const missing = sel.entries.filter((e) => !used.has(e.name.toLowerCase())).map((e) => e.name);

  return { sources: next, applied, missing, untouched };
}
