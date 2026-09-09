/**
 * キーワード 1 件のテキスト表記。
 * キーワードの既定値定義（keywords.ts）と、テキスト入出力（keywordText.ts）の
 * 両方から使うため独立させている（相互 import を避ける）。
 *
 *   顧客名簿   部分一致
 *   "SD"       単語単位（前後が英数字なら一致しない）
 *   /re/       正規表現
 */
export interface TermSpec {
  term: string;
  isRegex: boolean;
  wholeWord: boolean;
}

export function parseTerm(s: string): TermSpec {
  const re = /^\/(.+)\/$/.exec(s);
  if (re) return { term: re[1], isRegex: true, wholeWord: false };
  const w = /^"(.+)"$/.exec(s);
  if (w) return { term: w[1], isRegex: false, wholeWord: true };
  return { term: s, isRegex: false, wholeWord: false };
}

export function formatTerm(k: { term: string; isRegex: boolean; wholeWord?: boolean }): string {
  if (k.isRegex) return `/${k.term}/`;
  if (k.wholeWord) return `"${k.term}"`;
  return k.term;
}
