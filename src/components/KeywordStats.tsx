import { useState } from 'react';
import { findGroup } from '../lib/groups';
import { GroupDot } from './GroupBadge';
import type { KeywordGroup, KeywordStat } from '../types';

const TOP_N = 15;

interface Props {
  stats: KeywordStat[];
  groups: KeywordGroup[];
  /** ヒット行の総数（バーの基準） */
  totalRows: number;
  /** 上限に達していて、絞り込みが必要な状態か */
  needsNarrowing: boolean;
  onDisable: (keywordId: string, term: string) => void;
}

/**
 * どのキーワードが件数を稼いでいるかの一覧。
 * 上限に達したときに「どれを外せばいいか」を一目で分かるようにするのが目的。
 */
export function KeywordStats({ stats, groups, totalRows, needsNarrowing, onDisable }: Props) {
  const [open, setOpen] = useState(needsNarrowing);
  const [showAll, setShowAll] = useState(false);

  if (stats.length === 0) return null;

  const shown = showAll ? stats : stats.slice(0, TOP_N);
  const max = stats[0]?.rows ?? 1;

  return (
    <div className={`kw-stats${needsNarrowing ? ' urgent' : ''}`}>
      <button className="kw-stats-head" onClick={() => setOpen((v) => !v)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <strong>キーワード別ヒット件数</strong>
        <span className="muted">
          {stats.length} 語がヒット
          {needsNarrowing && ' — 件数の多い語を外すと絞り込めます'}
        </span>
      </button>

      {open && (
        <>
          <ul className="kw-stats-list">
            {shown.map((s) => {
              const g = findGroup(groups, s.groupId);
              return (
                <li key={s.keywordId}>
                  <GroupDot group={g} />
                  <span className="kws-term" title={`${s.term}（${g.name}）`}>
                    {s.term}
                    {/* 同じ語が複数グループに登録されていることがあるので名前で区別する */}
                    <span className="kws-persp muted">{g.name}</span>
                  </span>
                  <span className="kws-bar">
                    <span
                      className="kws-fill"
                      style={{
                        width: `${Math.max(2, (s.rows / max) * 100)}%`,
                        background: g.color,
                      }}
                    />
                  </span>
                  <span className="kws-count mono">
                    {s.rows.toLocaleString()}
                    <span className="muted">
                      {' '}
                      ({totalRows > 0 ? ((s.rows / totalRows) * 100).toFixed(0) : 0}%)
                    </span>
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    title="このキーワードを無効にする（再解析が必要）"
                    onClick={() => onDisable(s.keywordId, s.term)}
                  >
                    無効化
                  </button>
                </li>
              );
            })}
          </ul>
          {stats.length > TOP_N && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '上位のみ表示' : `残り ${stats.length - TOP_N} 語を表示`}
            </button>
          )}
          <p className="hint">
            件数は「ヒットした行数」です。1 行が複数の語に当たる場合、合計は総ヒット行数を超えます。
          </p>
        </>
      )}
    </div>
  );
}
