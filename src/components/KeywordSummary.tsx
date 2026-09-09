import { GroupDot } from './GroupBadge';
import type { Keyword, KeywordGroup } from '../types';

interface Props {
  keywords: Keyword[];
  groups: KeywordGroup[];
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onOpenSettings: () => void;
}

/** 解析画面に置く、グループごとのキーワード件数と有効／無効の要約。編集は設定画面で行う。 */
export function KeywordSummary({ keywords, groups, onToggleGroup, onOpenSettings }: Props) {
  const total = keywords.length;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>2. キーワード</h2>
        <button className="btn btn-sm" onClick={onOpenSettings}>
          キーワード設定を開く
        </button>
      </div>

      {total === 0 ? (
        <p className="kw-desc">
          キーワードが登録されていません。「キーワード設定」で追加するか、
          1 行 1 キーワードのテキストを読み込んでください。
        </p>
      ) : (
        <>
          <ul className="kw-summary">
            {groups.map((g) => {
              const mine = keywords.filter((k) => k.groupId === g.id);
              const on = mine.filter((k) => k.enabled).length;
              const allOn = mine.length > 0 && on === mine.length;
              return (
                <li key={g.id} className="kw-summary-row" style={{ borderLeftColor: g.color }}>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={on > 0}
                      disabled={mine.length === 0}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && !allOn;
                      }}
                      onChange={(e) => onToggleGroup(g.id, e.target.checked)}
                    />
                    <GroupDot group={g} />
                    <span className="kw-summary-label">{g.name}</span>
                  </label>
                  <span className="muted mono">
                    {on}/{mine.length}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="kw-desc">
            グループごとの有効／無効をここで切り替えられます。キーワードの追加・削除・
            テキストでの読み込み／書き出しは「キーワード設定」で行います。
          </p>
        </>
      )}
    </div>
  );
}
