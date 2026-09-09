/**
 * キーワードのテキスト形式（1 行 1 キーワード）の読み書き。
 *
 * 書式:
 *   - 1 行に 1 キーワード。空行は無視。
 *   - 「# グループ名」の行で以降のグループを切り替える。
 *     読み込み時に存在しないグループ名が出てきた場合は新しく作る。
 *   - "…" で囲むと単語単位で一致（例: "LINE" は online に当たらない）。
 *   - /…/ で囲むと正規表現として扱う。
 *   - 「#- 」で始まる行は「無効化されたキーワード」として読み込む（書き出し時にも使う）。
 *   - それ以外の「#」始まりの行はコメント。
 *
 * グループ名は利用者が自由に付けられるため、見出しかコメントかを字面だけでは
 * 判別できない。そこで「既知のグループ名に一致する行だけを見出しとして扱う」
 * のではなく、「# の後ろに何か書かれていれば見出し」とし、未知の名前は
 * 新規グループとして受け入れる方針にしている。コメントを書きたい場合は
 * 「## 」のように 2 個以上の # を使う。
 */
import type { Keyword, KeywordGroup } from '../types';
import { newKeyword } from './keywords';
import { newGroup, findGroupByName, uniqueName } from './groups';
import { formatTerm, parseTerm } from './termSyntax';

export interface ParsedKeywordText {
  keywords: Keyword[];
  /** 読み込みの結果、必要になったグループ一式（既存＋新規） */
  groups: KeywordGroup[];
  /** 新しく作られたグループ */
  createdGroups: KeywordGroup[];
  /** グループが決まらない状態で現れた行 */
  unassigned: string[];
  /** 見つかった見出しの数 */
  sections: number;
}

/**
 * テキストを解析してキーワード配列にする。
 *
 * @param existingGroups 既存のグループ（同名の見出しはここに割り当てる）
 * @param defaultGroupId 見出しが出るまでの行を入れるグループ。未指定なら unassigned へ
 */
export function parseKeywordText(
  text: string,
  existingGroups: KeywordGroup[],
  defaultGroupId?: string,
): ParsedKeywordText {
  const keywords: Keyword[] = [];
  const groups = [...existingGroups];
  const createdGroups: KeywordGroup[] = [];
  const unassigned: string[] = [];
  let sections = 0;
  let currentId: string | null = defaultGroupId ?? null;

  const push = (body: string, enabled: boolean) => {
    if (!currentId) {
      unassigned.push(body);
      return;
    }
    const spec = parseTerm(body);
    keywords.push(
      newKeyword(currentId, spec.term, {
        isRegex: spec.isRegex,
        wholeWord: spec.wholeWord,
        enabled,
      }),
    );
  };

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    if (raw.startsWith('#')) {
      if (raw.startsWith('#-')) {
        const body = raw.slice(2).trim();
        if (body) push(body, false);
        continue;
      }
      // 「##」以降はコメント
      if (raw.startsWith('##')) continue;

      const name = raw.slice(1).trim();
      if (!name) continue;

      const existing = findGroupByName(groups, name);
      if (existing) {
        currentId = existing.id;
      } else {
        const g = newGroup(uniqueName(groups, name), groups);
        groups.push(g);
        createdGroups.push(g);
        currentId = g.id;
      }
      sections++;
      continue;
    }

    push(raw, true);
  }

  return { keywords, groups, createdGroups, unassigned, sections };
}

/** 1 グループ分を見出し無しの行リストにする。 */
export function formatGroupText(keywords: Keyword[], groupId: string): string {
  return keywords
    .filter((k) => k.groupId === groupId)
    .map((k) => (k.enabled ? formatTerm(k) : `#- ${formatTerm(k)}`))
    .join('\n');
}

/** 全グループを見出し付きでまとめる。読み込み時にそのまま復元できる。 */
export function formatAllKeywordsText(keywords: Keyword[], groups: KeywordGroup[]): string {
  const head = [
    '## キーワードセット',
    '## 書式: 1行1キーワード / 「# グループ名」でグループを切替',
    '##       "…" で単語単位 / /…/ で正規表現 / 「#- 」で始まる行は無効化',
    '##       「##」で始まる行はコメント',
    '',
  ];
  const sections = groups.map((g) => {
    const body = formatGroupText(keywords, g.id);
    return `# ${g.name}\n${body}`.trimEnd();
  });
  return head.join('\n') + '\n' + sections.join('\n\n') + '\n';
}
