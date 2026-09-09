import type { Keyword } from '../types';
import { genId } from './id';

const STORAGE_KEY = 'sujimachi.keywords.v1';

/**
 * キーワードは初期状態では登録しない。
 *
 * 用途を限定しないツールなので、汎用的な既定語を用意しても大半の利用者には
 * 邪魔にしかならない。キーワードは目的ごとにテキストで読み込む運用を想定し、
 * 使い回すセットは .txt として利用者の手元で管理してもらう。
 * 動作確認用の例は samples/ に同梱している。
 */

/**
 * 保存済みデータの検証。
 * wholeWord は後から追加した項目なので、無くても弾かない
 * （弾くと既存の保存キーワードが失われてしまう）。
 */
function isKeyword(v: unknown): v is Keyword {
  if (typeof v !== 'object' || v === null) return false;
  const k = v as Record<string, unknown>;
  return (
    typeof k.id === 'string' &&
    typeof k.groupId === 'string' &&
    typeof k.term === 'string' &&
    typeof k.isRegex === 'boolean' &&
    typeof k.enabled === 'boolean' &&
    (k.wholeWord === undefined || typeof k.wholeWord === 'boolean')
  );
}

/** localStorage から復元。無ければ空。壊れていても空にフォールバックする。 */
export function loadKeywords(): Keyword[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every(isKeyword)) {
      return parsed.map((k) => ({ ...k, wholeWord: k.wholeWord ?? false }));
    }
  } catch {
    // ignore
  }
  return [];
}

/** localStorage へ保存。プライベートブラウズ等で失敗しても致命的にしない。 */
export function saveKeywords(keywords: Keyword[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keywords));
  } catch {
    // ignore
  }
}

export interface NewKeywordOptions {
  isRegex?: boolean;
  wholeWord?: boolean;
  enabled?: boolean;
}

/** 新規キーワードの生成。 */
export function newKeyword(groupId: string, term: string, opts: NewKeywordOptions = {}): Keyword {
  return {
    id: genId('kw'),
    groupId,
    term,
    isRegex: opts.isRegex ?? false,
    wholeWord: opts.wholeWord ?? false,
    enabled: opts.enabled ?? true,
  };
}

/** 重複判定用キー（グループ + 一致方式 + 語）。 */
export function keywordKey(
  k: Pick<Keyword, 'groupId' | 'isRegex' | 'term'> & { wholeWord?: boolean },
): string {
  const mode = k.isRegex ? 're' : k.wholeWord ? 'ww' : 'sub';
  return `${k.groupId} ${mode} ${k.term}`;
}

export interface MergeResult {
  merged: Keyword[];
  added: number;
  skipped: number;
}

/** 既存に無いものだけを末尾に追加する。 */
export function mergeKeywords(existing: Keyword[], incoming: Keyword[]): MergeResult {
  const seen = new Set(existing.map(keywordKey));
  const merged = [...existing];
  let added = 0;
  let skipped = 0;
  for (const k of incoming) {
    const key = keywordKey(k);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    merged.push(k);
    added++;
  }
  return { merged, added, skipped };
}

/** 指定グループのキーワードだけを incoming（同グループ分）で置き換える。 */
export function replaceGroupKeywords(
  existing: Keyword[],
  groupId: string,
  incoming: Keyword[],
): Keyword[] {
  const others = existing.filter((k) => k.groupId !== groupId);
  const mine = dedupe(incoming.filter((k) => k.groupId === groupId));
  return [...others, ...mine];
}

/** 配列内の重複を除く（先勝ち）。 */
export function dedupe(keywords: Keyword[]): Keyword[] {
  const seen = new Set<string>();
  const out: Keyword[] = [];
  for (const k of keywords) {
    const key = keywordKey(k);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}
