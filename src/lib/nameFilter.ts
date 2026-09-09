/**
 * ファイル名の絞り込み。
 *
 * 「Chrome という名前のファイルだけまとめて対象にしたい」といった操作のための、
 * 軽い検索式を解釈する。
 *
 *   Chrome            … 部分一致（大文字小文字を区別しない）
 *   Chrome Edge       … スペース区切りはどれかに一致（OR）
 *   /^Chrome.*\.csv$/ … 正規表現（キーワード設定と同じ書き方）
 */

export interface NameFilter {
  /** 空の式（すべてに一致する） */
  isEmpty: boolean;
  /** 正規表現が不正だった場合の説明。この場合は絞り込まない。 */
  error: string | null;
  test(name: string): boolean;
}

const MATCH_ALL: NameFilter = { isEmpty: true, error: null, test: () => true };

export function makeNameFilter(query: string): NameFilter {
  const q = query.trim();
  if (!q) return MATCH_ALL;

  if (q.length >= 2 && q.startsWith('/') && q.endsWith('/')) {
    const body = q.slice(1, -1);
    if (!body) return MATCH_ALL;
    try {
      const re = new RegExp(body, 'i');
      return { isEmpty: false, error: null, test: (name) => re.test(name) };
    } catch (e) {
      // 入力途中の式でリストが消えると操作しづらいので、エラー時は絞り込まない
      return {
        isEmpty: true,
        error: `正規表現が不正です: ${e instanceof Error ? e.message : String(e)}`,
        test: () => true,
      };
    }
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return MATCH_ALL;
  return {
    isEmpty: false,
    error: null,
    test: (name) => {
      const l = name.toLowerCase();
      return terms.some((t) => l.includes(t));
    },
  };
}
