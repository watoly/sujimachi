import type { KeywordGroup } from '../types';
import { genId } from './id';

const STORAGE_KEY = 'sujimachi.groups.v1';

/**
 * グループに割り当てる色。
 * 暗い背景の上で判別しやすく、隣り合っても区別できる並びにしてある。
 */
export const GROUP_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#22c55e', // green
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
];

/** 既存グループと重複しにくい色を選ぶ。 */
export function nextColor(existing: KeywordGroup[]): string {
  const used = new Set(existing.map((g) => g.color));
  return GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[existing.length % GROUP_COLORS.length];
}

/**
 * 初期グループ。
 * 用途を限定しない一般的な分類名にしてある。名前は設定画面で自由に変更できる。
 */
export function defaultGroups(): KeywordGroup[] {
  return [
    { id: 'group-1', name: '重要', color: GROUP_COLORS[2] },
    { id: 'group-2', name: '注意', color: GROUP_COLORS[1] },
    { id: 'group-3', name: '参考', color: GROUP_COLORS[0] },
  ];
}

export function newGroup(name: string, existing: KeywordGroup[]): KeywordGroup {
  return { id: genId('grp'), name, color: nextColor(existing) };
}

function isGroup(v: unknown): v is KeywordGroup {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return typeof g.id === 'string' && typeof g.name === 'string' && typeof g.color === 'string';
}

export function loadGroups(): KeywordGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultGroups();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isGroup)) return parsed;
  } catch {
    // ignore
  }
  return defaultGroups();
}

export function saveGroups(groups: KeywordGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // ignore
  }
}

/** id → グループ の索引。存在しない id 用のフォールバックも返せるようにしておく。 */
export function groupMap(groups: KeywordGroup[]): Record<string, KeywordGroup> {
  return Object.fromEntries(groups.map((g) => [g.id, g]));
}

export const UNKNOWN_GROUP: KeywordGroup = { id: '', name: '（未分類）', color: '#8b98a5' };

export function findGroup(groups: KeywordGroup[], id: string): KeywordGroup {
  return groups.find((g) => g.id === id) ?? UNKNOWN_GROUP;
}

/** 表示名からグループを引く（前後空白と大文字小文字を無視）。 */
export function findGroupByName(groups: KeywordGroup[], name: string): KeywordGroup | undefined {
  const n = name.trim().toLowerCase();
  return groups.find((g) => g.name.trim().toLowerCase() === n);
}

/** 名前が衝突しないようにする（「重要」「重要 (2)」…）。 */
export function uniqueName(groups: KeywordGroup[], base: string): string {
  const trimmed = base.trim() || 'グループ';
  if (!findGroupByName(groups, trimmed)) return trimmed;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!findGroupByName(groups, candidate)) return candidate;
  }
  return `${trimmed} (${Date.now()})`;
}
