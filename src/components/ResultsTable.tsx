import { Fragment, useEffect, useState } from 'react';
import { Highlight } from './Highlight';
import { makeSnippet } from '../lib/highlight';
import { findGroup } from '../lib/groups';
import { GroupBadge, TermChip } from './GroupBadge';
import type { CsvSource, KeywordGroup, MatchHit, RowResult } from '../types';

/** 一度に DOM 化する行数。数万件を一気に描画するとここで固まる。 */
const PAGE_SIZE = 200;

interface Props {
  sourcesById: Record<string, CsvSource>;
  groups: KeywordGroup[];
  results: RowResult[];
}

function uniqTerms(hits: MatchHit[]): { term: string; groupId: string }[] {
  const seen = new Set<string>();
  const out: { term: string; groupId: string }[] = [];
  for (const h of hits) {
    const key = `${h.groupId}:${h.term}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term: h.term, groupId: h.groupId });
  }
  return out;
}

export function ResultsTable({ sourcesById, groups, results }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  // 絞り込みが変わったら先頭に戻す
  useEffect(() => {
    setVisible(PAGE_SIZE);
    setExpanded(null);
  }, [results]);

  if (results.length === 0) {
    return <p className="empty">条件に一致する行はありません。</p>;
  }

  const shown = results.slice(0, visible);

  return (
    <>
      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr>
              <th className="c-num">#</th>
              <th className="c-file">ファイル</th>
              <th className="c-ts">日時</th>
              <th className="c-persp">グループ</th>
              <th className="c-terms">マッチキーワード</th>
              <th className="c-match">マッチ箇所</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const key = `${r.fileId}:${r.rowIndex}`;
              const isOpen = expanded === key;
              const source = sourcesById[r.fileId];
              const ts = source?.timestampColumn ? r.row[source.timestampColumn] : '';

              const byColumn = new Map<string, MatchHit[]>();
              for (const h of r.hits) {
                const arr = byColumn.get(h.column) ?? [];
                arr.push(h);
                byColumn.set(h.column, arr);
              }

              return (
                <Fragment key={key}>
                  <tr className={`row${isOpen ? ' open' : ''}`} onClick={() => setExpanded(isOpen ? null : key)}>
                    <td className="c-num">{r.rowIndex + 1}</td>
                    <td className="c-file" title={r.fileName}>
                      {r.fileName}
                    </td>
                    <td className="c-ts mono">{ts || '—'}</td>
                    <td className="c-persp">
                      {r.groupIds.map((id) => (
                        <GroupBadge key={id} group={findGroup(groups, id)} />
                      ))}
                    </td>
                    <td className="c-terms">
                      {uniqTerms(r.hits).map((t, i) => (
                        <TermChip key={i} group={findGroup(groups, t.groupId)} term={t.term} />
                      ))}
                      {r.truncated && (
                        <span className="term-chip muted" title="この行のヒットは上限で打ち切られています">
                          …
                        </span>
                      )}
                    </td>
                    <td className="c-match">
                      {Array.from(byColumn.entries()).map(([col, hits]) => {
                        const snip = makeSnippet(r.row[col] ?? '', hits);
                        return (
                          <div key={col} className="match-line">
                            <span className="match-col">{col}</span>
                            <span className="match-val mono">
                              <Highlight value={snip.value} hits={snip.hits} />
                            </span>
                          </div>
                        );
                      })}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row">
                      <td colSpan={6}>
                        <div className="detail">
                          <dl>
                            {(source?.headers ?? Object.keys(r.row)).map((h) => (
                              <div key={h} className="detail-item">
                                <dt>{h}</dt>
                                <dd className="mono">{r.row[h] || '—'}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible < results.length && (
        <div className="more-bar">
          <span className="muted">
            {shown.length.toLocaleString()} / {results.length.toLocaleString()} 件を表示中
          </span>
          <button className="btn btn-sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            さらに {PAGE_SIZE} 件
          </button>
          <button className="btn btn-sm" onClick={() => setVisible(results.length)}>
            すべて表示（重くなる場合があります）
          </button>
        </div>
      )}
    </>
  );
}
