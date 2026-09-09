import Papa from 'papaparse';
import type { CsvSource, KeywordGroup, RowResult } from '../types';
import { findGroup } from './groups';

/** ブラウザでファイルダウンロードを発火する（自端末のブラウザ前提）。 */
function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** プレーンテキスト（UTF-8、BOM 無し）を書き出す。 */
export function downloadText(filename: string, content: string): void {
  download(filename, content, 'text/plain;charset=utf-8');
}

/**
 * マッチ結果を CSV として書き出す。
 * ファイルごとにカラムが異なるため、ヒットのあったファイルのカラムの和集合を列にし、
 * 先頭に本ツールが付与する 4 カラム（ファイル / グループ / キーワード / マッチカラム）を足す。
 */
export function exportResultsCsv(
  sources: CsvSource[],
  results: RowResult[],
  groups: KeywordGroup[],
): void {
  const extra = ['ファイル', 'グループ', 'マッチキーワード', 'マッチカラム'];

  const hitFileIds = new Set(results.map((r) => r.fileId));
  const union: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (!hitFileIds.has(s.id)) continue;
    for (const h of s.headers) {
      if (seen.has(h)) continue;
      seen.add(h);
      union.push(h);
    }
  }
  const fields = [...extra, ...union];

  const data = results.map((r) => {
    const out: Record<string, string> = {};
    out['ファイル'] = r.fileName;
    out['グループ'] = uniq(r.groupIds.map((id) => findGroup(groups, id).name)).join(' / ');
    out['マッチキーワード'] = uniq(r.hits.map((h) => h.term)).join(' | ');
    out['マッチカラム'] = uniq(r.hits.map((h) => h.column)).join(' | ');
    for (const h of union) out[h] = r.row[h] ?? '';
    return out;
  });

  const content = Papa.unparse({ fields, data }, { quotes: true });
  // Excel での文字化け回避に BOM 付き UTF-8
  download(`matches_${timestampForFile()}.csv`, '﻿' + content, 'text/csv;charset=utf-8');
}
