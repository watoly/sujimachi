import { useRef, useState } from 'react';
import {
  dedupe,
  mergeKeywords,
  newKeyword,
  replaceGroupKeywords,
} from '../lib/keywords';
import { formatAllKeywordsText, formatGroupText, parseKeywordText } from '../lib/keywordText';
import { GROUP_COLORS, newGroup, uniqueName } from '../lib/groups';
import { downloadText, timestampForFile } from '../lib/export';
import type { Keyword, KeywordGroup } from '../types';

/** 一致方式を 部分一致 → 単語単位 → 正規表現 → 部分一致 と巡回させる。 */
function cycleMode(k: Keyword): Keyword {
  if (k.isRegex) return { ...k, isRegex: false, wholeWord: false };
  if (k.wholeWord) return { ...k, isRegex: true, wholeWord: false };
  return { ...k, wholeWord: true };
}

function modeLabel(k: Keyword): string {
  if (k.isRegex) return '正規表現';
  if (k.wholeWord) return '単語単位（前後が英数字なら一致しない）';
  return '部分一致';
}

type ImportMode = 'merge' | 'replace';

interface Props {
  keywords: Keyword[];
  groups: KeywordGroup[];
  onChange: (keywords: Keyword[]) => void;
  onGroupsChange: (groups: KeywordGroup[]) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (v: boolean) => void;
  regexErrors: Record<string, string>;
  onNotice: (message: string) => void;
  onBack: () => void;
}

export function KeywordSettings({
  keywords,
  groups,
  onChange,
  onGroupsChange,
  caseSensitive,
  onCaseSensitiveChange,
  regexErrors,
  onNotice,
  onBack,
}: Props) {
  const allImportRef = useRef<HTMLInputElement>(null);
  const [allMode, setAllMode] = useState<ImportMode>('merge');

  function exportAll() {
    downloadText(`keywords_${timestampForFile()}.txt`, formatAllKeywordsText(keywords, groups));
  }

  function importAll(text: string) {
    const parsed = parseKeywordText(text, groups);
    if (parsed.sections === 0) {
      onNotice(
        'グループの見出し（例: 「# 重要」）が見つかりませんでした。見出し無しのリストは各グループの欄から読み込んでください。',
      );
      return;
    }
    onGroupsChange(parsed.groups);
    const created = parsed.createdGroups.length
      ? `。新しいグループを ${parsed.createdGroups.length} 個作成（${parsed.createdGroups.map((g) => g.name).join(', ')}）`
      : '';
    const ignored = parsed.unassigned.length ? `。見出しより前の ${parsed.unassigned.length} 行は無視` : '';

    if (allMode === 'replace') {
      onChange(dedupe(parsed.keywords));
      onNotice(`すべて置き換えました（${parsed.keywords.length} 件）${created}${ignored}。`);
    } else {
      const r = mergeKeywords(keywords, parsed.keywords);
      onChange(r.merged);
      onNotice(`${r.added} 件追加しました（重複 ${r.skipped} 件はスキップ）${created}${ignored}。`);
    }
  }

  function addGroup() {
    const g = newGroup(uniqueName(groups, '新しいグループ'), groups);
    onGroupsChange([...groups, g]);
  }

  function renameGroup(id: string, name: string) {
    onGroupsChange(groups.map((g) => (g.id === id ? { ...g, name } : g)));
  }

  function recolorGroup(id: string, color: string) {
    onGroupsChange(groups.map((g) => (g.id === id ? { ...g, color } : g)));
  }

  function removeGroup(id: string) {
    if (groups.length <= 1) {
      onNotice('グループは 1 つ以上必要です。');
      return;
    }
    const g = groups.find((x) => x.id === id);
    const count = keywords.filter((k) => k.groupId === id).length;
    onGroupsChange(groups.filter((x) => x.id !== id));
    onChange(keywords.filter((k) => k.groupId !== id));
    onNotice(`グループ「${g?.name}」とキーワード ${count} 件を削除しました。`);
  }

  return (
    <div className="settings">
      <div className="settings-toolbar panel">
        <button className="btn" onClick={onBack}>
          ← 解析画面へ戻る
        </button>
        <label className="switch" title="オフだと大文字小文字を区別しません">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => onCaseSensitiveChange(e.target.checked)}
          />
          <span>大文字小文字を区別</span>
        </label>
        <div className="spacer" />
        <button className="btn" onClick={addGroup}>
          ＋ グループを追加
        </button>
        <button className="btn" onClick={exportAll} title="全グループを見出し付きのテキストで書き出し">
          まとめて書き出し (.txt)
        </button>
        <div className="import-group">
          <button className="btn" onClick={() => allImportRef.current?.click()}>
            まとめて読み込み (.txt)
          </button>
          <label className="radio">
            <input
              type="radio"
              name="allMode"
              checked={allMode === 'merge'}
              onChange={() => setAllMode('merge')}
            />
            追加
          </label>
          <label className="radio">
            <input
              type="radio"
              name="allMode"
              checked={allMode === 'replace'}
              onChange={() => setAllMode('replace')}
            />
            すべて置き換え
          </label>
          <input
            ref={allImportRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) importAll(await f.text());
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <details className="help panel">
        <summary>テキスト形式の書式</summary>
        <ul>
          <li>1 行に 1 キーワード。空行は無視されます。</li>
          <li>
            「まとめて」形式では <code># グループ名</code> の見出し行でグループを切り替えます。
            読み込み時に存在しない名前が出てきた場合は、そのグループを新しく作ります。
          </li>
          <li>各グループの欄から読み込む場合は見出し不要です。そのままリストを貼り付けてください。</li>
          <li>
            <code>"…"</code> で囲むと単語単位で一致します（例: <code>"LINE"</code> は online や
            deadline に当たりません）。前後が英数字のときだけ効くので、日本語の語には影響しません。
          </li>
          <li>
            <code>/…/</code> で囲むと正規表現として扱います（例: <code>/[a-z.]+@example\.com/</code>）。
          </li>
          <li>
            <code>#- </code> で始まる行は「無効化されたキーワード」として読み込まれます。
            <code>##</code> で始まる行はコメントです。
          </li>
        </ul>
      </details>

      <div className="settings-grid">
        {groups.map((g) => (
          <GroupEditor
            key={g.id}
            group={g}
            groups={groups}
            keywords={keywords}
            onChange={onChange}
            onGroupsChange={onGroupsChange}
            onRename={renameGroup}
            onRecolor={recolorGroup}
            onRemove={removeGroup}
            regexErrors={regexErrors}
            onNotice={onNotice}
          />
        ))}
      </div>
    </div>
  );
}

interface EditorProps {
  group: KeywordGroup;
  groups: KeywordGroup[];
  keywords: Keyword[];
  onChange: (keywords: Keyword[]) => void;
  onGroupsChange: (groups: KeywordGroup[]) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onRemove: (id: string) => void;
  regexErrors: Record<string, string>;
  onNotice: (message: string) => void;
}

function GroupEditor({
  group,
  groups,
  keywords,
  onChange,
  onGroupsChange,
  onRename,
  onRecolor,
  onRemove,
  regexErrors,
  onNotice,
}: EditorProps) {
  const mine = keywords.filter((k) => k.groupId === group.id);
  const enabledCount = mine.filter((k) => k.enabled).length;

  const [term, setTerm] = useState('');
  const [addMode, setAddMode] = useState<'sub' | 'word' | 'regex'>('sub');
  const [text, setText] = useState('');
  const [palette, setPalette] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function toggle(id: string) {
    onChange(keywords.map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k)));
  }
  function remove(id: string) {
    onChange(keywords.filter((k) => k.id !== id));
  }
  function cycle(id: string) {
    onChange(keywords.map((k) => (k.id === id ? cycleMode(k) : k)));
  }
  function setAll(enabled: boolean) {
    onChange(keywords.map((k) => (k.groupId === group.id ? { ...k, enabled } : k)));
  }
  function clearAll() {
    onChange(keywords.filter((k) => k.groupId !== group.id));
    onNotice(`「${group.name}」のキーワードをすべて削除しました。`);
  }
  function add() {
    const t = term.trim();
    if (!t) return;
    const kw = newKeyword(group.id, t, {
      isRegex: addMode === 'regex',
      wholeWord: addMode === 'word',
    });
    const r = mergeKeywords(keywords, [kw]);
    onChange(r.merged);
    if (r.skipped) onNotice(`「${t}」は既に登録されています。`);
    setTerm('');
  }

  function exportMine() {
    const safe = group.name.replace(/[^\w\-一-龠ぁ-んァ-ヶ]/g, '_');
    downloadText(`keywords_${safe}_${timestampForFile()}.txt`, formatGroupText(keywords, group.id));
  }

  function importText(mode: ImportMode) {
    if (!text.trim()) {
      onNotice('読み込むテキストが空です。');
      return;
    }
    const parsed = parseKeywordText(text, groups, group.id);
    if (parsed.createdGroups.length > 0) onGroupsChange(parsed.groups);

    if (mode === 'replace') {
      const replaced = replaceGroupKeywords(keywords, group.id, parsed.keywords);
      const others = parsed.keywords.filter((k) => k.groupId !== group.id);
      const r = mergeKeywords(replaced, others);
      onChange(r.merged);
      const mineCount = parsed.keywords.length - others.length;
      onNotice(
        `「${group.name}」を ${mineCount} 件で置き換えました${others.length ? `（他グループへ ${r.added} 件追加）` : ''}。`,
      );
    } else {
      const r = mergeKeywords(keywords, parsed.keywords);
      onChange(r.merged);
      onNotice(`「${group.name}」に ${r.added} 件追加しました（重複 ${r.skipped} 件はスキップ）。`);
    }
    setText('');
  }

  return (
    <section className="kw-editor" style={{ borderTopColor: group.color }}>
      <header>
        <button
          className="color-swatch"
          style={{ background: group.color }}
          title="色を変更"
          onClick={() => setPalette((v) => !v)}
        />
        <input
          className="group-name"
          value={group.name}
          onChange={(e) => onRename(group.id, e.target.value)}
          title="グループ名（クリックで編集）"
        />
        <span className="muted mono">
          {enabledCount}/{mine.length}
        </span>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>
          全有効
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>
          全無効
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportMine}>
          書き出し
        </button>
        <button className="btn btn-ghost btn-sm danger" onClick={clearAll} title="このグループのキーワードを全削除">
          語を全削除
        </button>
        <button
          className="btn btn-ghost btn-sm danger"
          onClick={() => onRemove(group.id)}
          title="このグループ自体を削除"
        >
          ✕
        </button>
      </header>

      {palette && (
        <div className="palette">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              className={`palette-dot${c === group.color ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => {
                onRecolor(group.id, c);
                setPalette(false);
              }}
            />
          ))}
        </div>
      )}

      <div className="kw-chips">
        {mine.length === 0 && <span className="muted">キーワードはありません。</span>}
        {mine.map((k) => {
          const err = regexErrors[k.id];
          return (
            <span
              key={k.id}
              className={`kw-chip${k.enabled ? '' : ' off'}${err ? ' err' : ''}`}
              title={err ? `正規表現エラー: ${err}` : modeLabel(k)}
            >
              <input type="checkbox" checked={k.enabled} onChange={() => toggle(k.id)} />
              <button
                type="button"
                className={`kw-term${k.isRegex ? ' regex' : ''}${k.wholeWord ? ' word' : ''}`}
                onClick={() => cycle(k.id)}
                title={`${modeLabel(k)} — クリックで 部分一致 → 単語単位 → 正規表現 を切り替え`}
              >
                {k.isRegex ? `/${k.term}/` : k.wholeWord ? `"${k.term}"` : k.term}
              </button>
              <button type="button" className="kw-del" onClick={() => remove(k.id)} title="削除">
                ×
              </button>
            </span>
          );
        })}
      </div>

      <div className="kw-add">
        <input
          type="text"
          value={term}
          placeholder="キーワードを 1 件追加"
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <select
          className="mode-select"
          value={addMode}
          onChange={(e) => setAddMode(e.target.value as 'sub' | 'word' | 'regex')}
          title="一致方式"
        >
          <option value="sub">部分一致</option>
          <option value="word">単語単位</option>
          <option value="regex">正規表現</option>
        </select>
        <button className="btn btn-sm" onClick={add}>
          追加
        </button>
      </div>

      <div className="kw-import">
        <div className="kw-import-head">
          <span className="muted">テキストから読み込み（1 行 1 キーワード）</span>
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            ファイルを選択…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={'エラー\n"LINE"\n/[a-z.]+@example\\.com/'}
          spellCheck={false}
        />
        <div className="kw-import-actions">
          <button className="btn btn-sm" onClick={() => importText('merge')} disabled={!text.trim()}>
            追加
          </button>
          <button className="btn btn-sm" onClick={() => importText('replace')} disabled={!text.trim()}>
            このグループを置き換え
          </button>
        </div>
      </div>
    </section>
  );
}
