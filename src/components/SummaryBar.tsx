import { GroupDot } from './GroupBadge';
import type { KeywordGroup } from '../types';

export type GroupFilter = string | 'all';

interface Props {
  totalRows: number;
  matchedRows: number;
  groups: KeywordGroup[];
  countsByGroup: Record<string, number>;
  active: GroupFilter;
  onSelect: (f: GroupFilter) => void;
}

export function SummaryBar({
  totalRows,
  matchedRows,
  groups,
  countsByGroup,
  active,
  onSelect,
}: Props) {
  // グループ数は可変なので、列数もそれに合わせる（多すぎるときは折り返す）
  const columns = Math.min(groups.length + 1, 5);

  return (
    <div className="summary" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      <button
        className={`stat${active === 'all' ? ' active' : ''}`}
        onClick={() => onSelect('all')}
      >
        <span className="stat-num">{matchedRows.toLocaleString()}</span>
        <span className="stat-label">ヒット行（全 {totalRows.toLocaleString()} 行中）</span>
      </button>

      {groups.map((g) => (
        <button
          key={g.id}
          className={`stat${active === g.id ? ' active' : ''}`}
          style={active === g.id ? { borderColor: g.color } : undefined}
          onClick={() => onSelect(g.id)}
        >
          <span className="stat-num">{(countsByGroup[g.id] ?? 0).toLocaleString()}</span>
          <span className="stat-label">
            <GroupDot group={g} />
            {g.name}
          </span>
        </button>
      ))}
    </div>
  );
}
