import Papa from 'papaparse';
import type { CsvSource } from '../types';
import { genId } from './id';
import { detachRow, detachString } from './strings';

/** ヘッダーと列の性質を判定するために先頭から読むバイト数。 */
const HEAD_BYTES = 512 * 1024;
/** 判定に使うサンプル行の上限。 */
const MAX_SAMPLE_ROWS = 300;

export function isCsvFileName(name: string): boolean {
  return /\.csv$/i.test(name);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * ファイルの先頭だけを読み、ヘッダー・サンプル行・推定行数を得る。
 * 全行は読まない（数百万行のファイルでもここは一瞬で終わる）。
 */
export async function readCsvSource(file: File): Promise<CsvSource> {
  const head = file.slice(0, HEAD_BYTES);
  const raw = stripBom(await head.text());

  // 先頭 512KB で切った場合、最終行は途中で切れている可能性が高いので落とす
  const truncated = file.size > HEAD_BYTES;
  const lastNl = raw.lastIndexOf('\n');
  const text = truncated && lastNl > 0 ? raw.slice(0, lastNl) : raw;

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: (h) => stripBom(h).trim(),
  });

  // ヘッダーも先頭 512KB からの部分文字列。MatchHit.column などで長く保持されるため、
  // ここで切り離しておかないとファイルごとに 512KB が居座る（164 ファイルで 84MB）。
  const headers = (parsed.meta.fields ?? []).filter((h) => h.length > 0).map(detachString);

  if (headers.length === 0) {
    throw new Error(`${file.name}: ヘッダー行を検出できませんでした。`);
  }

  const sampleRows: Record<string, string>[] = [];
  for (const r of parsed.data) {
    if (sampleRows.length >= MAX_SAMPLE_ROWS) break;
    const row: Record<string, string> = {};
    for (const h of headers) {
      const v = r[h];
      row[h] = v == null ? '' : String(v);
    }
    sampleRows.push(detachRow(row));
  }

  // 推定行数: サンプル区間の 1 行あたりバイト数から外挿する
  const sampledBytes = new Blob([text]).size;
  const sampledRowCount = parsed.data.length;
  const bytesPerRow = sampledRowCount > 0 ? sampledBytes / sampledRowCount : 0;
  const estimatedRows =
    bytesPerRow > 0 ? Math.max(sampledRowCount, Math.round(file.size / bytesPerRow)) : 0;

  return {
    id: genId('file'),
    file,
    fileName: file.name,
    size: file.size,
    headers,
    sampleRows,
    estimatedRows,
    searchColumns: [...headers],
    timestampColumn: guessTimestampColumn(headers, sampleRows),
    lowValueColumns: detectLowValueColumns(headers, sampleRows),
    enabled: true,
  };
}

/** 日付らしい値（YYYY-MM-DD / YYYY/MM/DD / MM/DD/YYYY、時刻付きも可）。 */
const DATE_RE =
  /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})([ T]\d{1,2}:\d{2}(:\d{2})?)?/;

/** 数値のみ（桁区切り・符号・小数点を含む）。 */
const NUMERIC_RE = /^\s*[-+]?[\d,]+(\.\d+)?\s*$/;

/** カラム名からの優先度付け用ヒント（先頭ほど強い）。 */
const NAME_HINTS = [
  'date/time', 'date time', 'datetime', 'timestamp', '(utc)', 'utc',
  'date', 'time', '日時', '日付', '時刻',
  'connected', 'last run', 'accessed', 'modified', 'created', 'visited', 'sent', 'received',
];

/**
 * 値をサンプリングして日付らしいカラムか判定する。
 * true: 日付らしい / false: 日付ではない / null: 判定できる値が無い
 */
function sniffDateColumn(rows: Record<string, string>[], header: string): boolean | null {
  let seen = 0;
  let dateLike = 0;
  for (const r of rows) {
    const v = r[header];
    if (!v || !v.trim()) continue;
    seen++;
    if (DATE_RE.test(v)) dateLike++;
    if (seen >= 30) break;
  }
  if (seen === 0) return null;
  return dateLike / seen >= 0.7;
}

/**
 * 結果表示に使う日時カラムを推測する。
 * 日時カラムの名前はファイルごとにまちまち（Date/Time, created_at, Last Run (UTC) …）なので、
 * カラム名のヒントで候補を並べつつ、最終的には値が日付らしいかで判断する。
 */
export function guessTimestampColumn(
  headers: string[],
  rows: Record<string, string>[] = [],
): string | null {
  const lower = headers.map((h) => ({ h, l: h.toLowerCase() }));

  const ranked: string[] = [];
  for (const hint of NAME_HINTS) {
    for (const x of lower) {
      if (x.l.includes(hint) && !ranked.includes(x.h)) ranked.push(x.h);
    }
  }
  for (const h of ranked) {
    if (sniffDateColumn(rows, h) !== false) return h;
  }
  for (const h of headers) {
    if (sniffDateColumn(rows, h) === true) return h;
  }
  return null;
}

/**
 * 「数値のみ」「日時のみ」の列を検出する。連番 ID や各種タイムスタンプなどが該当し、
 * 検索対象から外すと解析が軽くなる。
 *
 * ただし自動では外さない。エラーコードや伝票番号のように数値列を狙うキーワードが
 * ありうるため、黙って除外すると取りこぼす。UI のヒントとしてのみ使う。
 */
export function detectLowValueColumns(
  headers: string[],
  rows: Record<string, string>[],
): string[] {
  const out: string[] = [];
  for (const h of headers) {
    let seen = 0;
    let boring = 0;
    for (const r of rows) {
      const v = r[h];
      if (!v || !v.trim()) continue;
      seen++;
      if (NUMERIC_RE.test(v) || DATE_RE.test(v)) boring++;
      if (seen >= 100) break;
    }
    // 判断材料が少ない列は「価値が低い」と決めつけない
    if (seen >= 20 && boring / seen >= 0.98) out.push(h);
  }
  return out;
}
