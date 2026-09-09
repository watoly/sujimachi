import type { KeywordGroup } from '../types';

/**
 * グループの色はユーザーが変更できるためデータとして持っている。
 * CSS クラスでは表現できないので、色に関わる部分はインラインスタイルで描く。
 */

export function GroupDot({ group, title }: { group: KeywordGroup; title?: string }) {
  return <span className="dot" style={{ background: group.color }} title={title ?? group.name} />;
}

export function GroupBadge({ group }: { group: KeywordGroup }) {
  return (
    <span className="badge" style={{ background: group.color }} title={group.name}>
      {group.name}
    </span>
  );
}

/** マッチした語のチップ。所属グループの色で縁取る。 */
export function TermChip({ group, term }: { group: KeywordGroup; term: string }) {
  return (
    <span className="term-chip" style={{ color: group.color, borderColor: group.color }}>
      {term}
    </span>
  );
}
