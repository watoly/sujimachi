import type { MatchHit } from '../types';

export interface Segment {
  text: string;
  /** マッチ部分なら true */
  mark: boolean;
}

/**
 * セル値と、そのセル内のヒット群から、ハイライト用のセグメント列を作る。
 * 重なり合うマッチはマージする。
 */
export function buildSegments(value: string, hits: MatchHit[]): Segment[] {
  if (hits.length === 0) return [{ text: value, mark: false }];

  // start 昇順、同 start は end 降順
  const ranges = hits
    .map((h) => ({ start: h.start, end: h.end }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // マージ
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) segments.push({ text: value.slice(cursor, r.start), mark: false });
    segments.push({ text: value.slice(r.start, r.end), mark: true });
    cursor = r.end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), mark: false });

  return segments;
}

/**
 * 長いセル値を、最初のマッチ周辺だけ残して前後を省略する。
 * オフセットを保った新しい value とヒット配列を返す。
 */
export function makeSnippet(
  value: string,
  hits: MatchHit[],
  context = 48,
): { value: string; hits: MatchHit[] } {
  if (hits.length === 0 || value.length <= context * 2) {
    return { value, hits };
  }

  const firstStart = Math.min(...hits.map((h) => h.start));
  const lastEnd = Math.max(...hits.map((h) => h.end));

  let from = Math.max(0, firstStart - context);
  let to = Math.min(value.length, lastEnd + context);

  // 全マッチを含みつつ長すぎる場合は末尾側を優先的に切る
  const MAX = context * 6;
  if (to - from > MAX) to = from + MAX;

  const prefix = from > 0 ? '… ' : '';
  const suffix = to < value.length ? ' …' : '';
  const sliced = value.slice(from, to);

  const shift = from - prefix.length;
  const shifted: MatchHit[] = hits
    .filter((h) => h.start >= from && h.end <= to)
    .map((h) => ({ ...h, start: h.start - shift, end: h.end - shift }));

  return { value: prefix + sliced + suffix, hits: shifted };
}
