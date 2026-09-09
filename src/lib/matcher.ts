import type { Keyword, MatchHit } from '../types';
import { buildAutomaton, scan, type AcAutomaton, type AcPattern } from './ahocorasick';

/** 事前コンパイル済みキーワード。 */
export interface CompiledKeyword {
  id: string;
  groupId: string;
  term: string;
  isRegex: boolean;
  /** 部分一致用（caseSensitive=false のとき小文字化済み） */
  needle: string;
  /** 正規表現用（global フラグ付き）。コンパイル失敗時は null。 */
  regex: RegExp | null;
  /** 単語単位で一致させるか（正規表現には適用しない） */
  wholeWord: boolean;
  /** 語の先頭が ASCII 英数字か（左側の境界を検査すべきか） */
  checkLeft: boolean;
  /** 語の末尾が ASCII 英数字か（右側の境界を検査すべきか） */
  checkRight: boolean;
  error?: string;
}

/** ASCII 英数字か。アンダースコアは含めない（SD_CARD の SD を拾いたいため）。 */
function isAsciiWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) // a-z
  );
}

/**
 * 単語単位の境界判定。
 *
 * 日本語には語の区切りが無いため、単純な \b 相当を全語に適用すると
 * 「顧客」が「顧客名簿」に一致しなくなり実用にならない。そこで
 * 「キーワードのその側の端が ASCII 英数字のときだけ、隣接文字も
 * ASCII 英数字でないことを要求する」という規則にしている。
 *
 *   "SD"    両端が英数字 → 両側を検査。SDELETE64 は不一致、SD_CARD は一致
 *   ".xlsx" 先頭が '.' → 左は検査しない。2025.xlsx は一致、.xlsxbak は不一致
 *   "顧客"   両端が日本語 → どちらも検査しない＝常に一致
 */
function boundaryOk(hay: string, start: number, end: number, kw: CompiledKeyword): boolean {
  if (kw.checkLeft && start > 0 && isAsciiWordChar(hay.charCodeAt(start - 1))) return false;
  if (kw.checkRight && end < hay.length && isAsciiWordChar(hay.charCodeAt(end))) return false;
  return true;
}

export interface CompileResult {
  compiled: CompiledKeyword[];
  /** コンパイルに失敗した正規表現キーワードの id → エラー文言 */
  errors: Record<string, string>;
}

/** enabled なキーワードのみをコンパイルする。 */
export function compileKeywords(keywords: Keyword[], caseSensitive: boolean): CompileResult {
  const compiled: CompiledKeyword[] = [];
  const errors: Record<string, string> = {};

  for (const kw of keywords) {
    if (!kw.enabled) continue;
    const term = kw.term;
    if (term.length === 0) continue;

    const base = {
      id: kw.id,
      groupId: kw.groupId,
      term,
      // 正規表現には単語単位を適用しない（\b は利用者が自分で書ける）
      wholeWord: !kw.isRegex && !!kw.wholeWord,
      checkLeft: isAsciiWordChar(term.charCodeAt(0)),
      checkRight: isAsciiWordChar(term.charCodeAt(term.length - 1)),
    };

    if (kw.isRegex) {
      try {
        const regex = new RegExp(term, caseSensitive ? 'g' : 'gi');
        compiled.push({ ...base, isRegex: true, needle: term, regex });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors[kw.id] = msg;
        compiled.push({ ...base, isRegex: true, needle: term, regex: null, error: msg });
      }
    } else {
      compiled.push({
        ...base,
        isRegex: false,
        needle: caseSensitive ? term : term.toLowerCase(),
        regex: null,
      });
    }
  }

  return { compiled, errors };
}

/**
 * 実際の検索に使う形。
 * 部分一致キーワードは Aho-Corasick へまとめ、正規表現だけ個別に回す。
 * 正規表現は通常わずかなので、この分割で全体がほぼ AC の速度になる。
 */
export interface Matcher {
  automaton: AcAutomaton;
  /** AcPattern.id → キーワード */
  byPatternId: CompiledKeyword[];
  regexes: CompiledKeyword[];
  caseSensitive: boolean;
  /** 有効なキーワードが 1 件も無いか */
  isEmpty: boolean;
}

export function buildMatcher(compiled: CompiledKeyword[], caseSensitive: boolean): Matcher {
  const byPatternId: CompiledKeyword[] = [];
  const patterns: AcPattern[] = [];
  const regexes: CompiledKeyword[] = [];

  for (const kw of compiled) {
    if (kw.isRegex) {
      if (kw.regex) regexes.push(kw);
      continue;
    }
    if (kw.needle.length === 0) continue;
    patterns.push({ id: byPatternId.length, pattern: kw.needle });
    byPatternId.push(kw);
  }

  const automaton = buildAutomaton(patterns);
  return {
    automaton,
    byPatternId,
    regexes,
    caseSensitive,
    isEmpty: patterns.length === 0 && regexes.length === 0,
  };
}

/**
 * 同じ語が 1 行内で何度出ても、記録するのはこの回数まで。
 *
 * 長いパスに「削除」が何十回も出るような行で、1 つの語が maxHitsPerRow の枠を
 * 食いつぶすと、その行の他のキーワードが記録されなくなる。表示が欠けるだけでなく
 * キーワード別ヒット件数（絞り込みの手がかり）も歪むため、語ごとに頭打ちにする。
 */
const MAX_HITS_PER_KEYWORD_PER_ROW = 3;

/** hits の中に同じキーワードが何件あるか。hits は maxHitsPerRow 件までなので線形で十分。 */
function countFor(hits: MatchHit[], keywordId: string): number {
  let n = 0;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].keywordId === keywordId) n++;
  }
  return n;
}

/**
 * 1 セルに対するマッチを求め、hits へ push する。
 * 戻り値は「行全体の上限に達して打ち切ったか」。
 * 語ごとの頭打ち（MAX_HITS_PER_KEYWORD_PER_ROW）は意図した間引きなので
 * 打ち切り扱いにはしない。
 */
function matchCell(
  value: string,
  column: string,
  matcher: Matcher,
  hits: MatchHit[],
  limit: number,
): boolean {
  let truncated = false;
  // AC は小文字化した文字列を走査する。長さは変わらないのでオフセットは共有できる。
  const hay = matcher.caseSensitive ? value : value.toLowerCase();

  scan(matcher.automaton, hay, (p, start, end) => {
    if (hits.length >= limit) {
      truncated = true;
      return;
    }
    const kw = matcher.byPatternId[p.id];
    if (kw.wholeWord && !boundaryOk(hay, start, end, kw)) return;
    if (countFor(hits, kw.id) >= MAX_HITS_PER_KEYWORD_PER_ROW) return;
    hits.push({
      groupId: kw.groupId,
      keywordId: kw.id,
      term: kw.term,
      column,
      start,
      end,
    });
  });

  for (const kw of matcher.regexes) {
    const re = kw.regex!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
      if (countFor(hits, kw.id) < MAX_HITS_PER_KEYWORD_PER_ROW) {
        hits.push({
          groupId: kw.groupId,
          keywordId: kw.id,
          term: kw.term,
          column,
          start: m.index,
          end: m.index + m[0].length,
        });
      }
      // 空マッチによる無限ループ回避
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  return truncated;
}

/** グループ ID をグループ定義の並び順にそろえる。 */
export function sortGroupIds(ids: Set<string>, order: string[]): string[] {
  return Array.from(ids).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });
}

export interface RowMatch {
  hits: MatchHit[];
  groupIds: string[];
  /** 1 行あたりのヒット上限に達して打ち切った */
  truncated: boolean;
}

/** 1 行を評価する。ヒットが無ければ null。 */
export function matchRow(
  row: Record<string, string>,
  searchColumns: string[],
  matcher: Matcher,
  maxHitsPerRow: number,
  groupOrder: string[],
): RowMatch | null {
  if (matcher.isEmpty) return null;

  const hits: MatchHit[] = [];
  let truncated = false;

  for (const col of searchColumns) {
    const val = row[col];
    if (!val) continue;
    if (matchCell(val, col, matcher, hits, maxHitsPerRow)) {
      truncated = true;
      break;
    }
  }

  if (hits.length === 0) return null;
  return {
    hits,
    groupIds: sortGroupIds(new Set(hits.map((h) => h.groupId)), groupOrder),
    truncated,
  };
}
