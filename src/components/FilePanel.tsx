import { useEffect, useMemo, useRef, useState } from 'react';
import { collectFilesFromDataTransfer } from '../lib/files';
import { formatApproxCount, formatBytes } from '../lib/format';
import { makeNameFilter } from '../lib/nameFilter';
import type { CsvSource } from '../types';

export interface LoadProgress {
  done: number;
  total: number;
}

type SortKey = 'size' | 'name';

/** これを超えるファイルには警告を出す。 */
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

interface Props {
  sources: CsvSource[];
  progress: LoadProgress | null;
  busy: boolean;
  /** ファイル名の絞り込み。選択状態と一緒に保存するので App が持つ。 */
  nameFilter: string;
  onNameFilterChange: (value: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<CsvSource, 'searchColumns' | 'timestampColumn' | 'enabled'>>,
  ) => void;
  /** ids を渡すとその分だけ、null なら全件をまとめて切り替える。 */
  onSetEnabled: (ids: string[] | null, enabled: boolean) => void;
  onExportSelection: () => void;
  onImportSelection: (file: File) => void;
}

export function FilePanel({
  sources,
  progress,
  busy,
  nameFilter,
  onNameFilterChange,
  onAddFiles,
  onRemove,
  onClearAll,
  onUpdate,
  onSetEnabled,
  onExportSelection,
  onImportSelection,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const selInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('size');

  // webkitdirectory は React の属性型に無いので直接付与する
  useEffect(() => {
    const el = dirInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

  const filter = useMemo(() => makeNameFilter(nameFilter), [nameFilter]);

  const visible = useMemo(() => {
    const list = sources.filter((s) => filter.test(s.fileName));
    if (sortKey === 'size') list.sort((a, b) => b.size - a.size);
    else list.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ja'));
    return list;
  }, [sources, sortKey, filter]);

  const enabled = sources.filter((s) => s.enabled);
  const totalBytes = sources.reduce((a, s) => a + s.size, 0);
  const enabledBytes = enabled.reduce((a, s) => a + s.size, 0);
  const enabledRows = enabled.reduce((a, s) => a + s.estimatedRows, 0);
  const filtering = !filter.isEmpty;

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    onAddFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  }

  function pickSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onImportSelection(f);
    e.target.value = '';
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>1. CSV を読み込む</h2>
        {sources.length > 0 && (
          <button className="btn btn-ghost" onClick={onClearAll} disabled={busy}>
            すべてクリア
          </button>
        )}
      </div>

      <div
        className={`dropzone compact${dragOver ? ' over' : ''}`}
        onClick={() => !busy && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          void collectFilesFromDataTransfer(e.dataTransfer).then(onAddFiles);
        }}
      >
        <p className="dz-title">CSV ファイル／フォルダをここにドロップ</p>
        <div className="dz-actions">
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            ファイルを選択
          </button>
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              dirInputRef.current?.click();
            }}
          >
            フォルダを選択
          </button>
        </div>
        <p className="dz-sub">
          読み込み時は各ファイルの先頭のみを確認します。全行の読み取りは解析実行時です。
        </p>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" multiple hidden onChange={pick} />
        <input ref={dirInputRef} type="file" multiple hidden onChange={pick} />
      </div>

      {progress && (
        <p className="muted loading-line">
          読み込み中… {progress.done}/{progress.total}
        </p>
      )}

      {sources.length > 0 && (
        <>
          <div className="file-toolbar">
            <span className="muted">
              {enabled.length}/{sources.length} ファイル・{formatBytes(enabledBytes)}
              {enabledBytes !== totalBytes && ` / 全 ${formatBytes(totalBytes)}`}・推定{' '}
              {formatApproxCount(enabledRows)} 行
            </span>
          </div>

          <div className="file-filter">
            <input
              className="filter-input"
              type="search"
              value={nameFilter}
              placeholder="ファイル名で絞り込み（例: Chrome）"
              onChange={(e) => onNameFilterChange(e.target.value)}
            />
            {filtering && (
              <span className="muted nowrap">
                {visible.length}/{sources.length} 件
              </span>
            )}
          </div>
          {filter.error ? (
            <p className="hint err">{filter.error}</p>
          ) : (
            filtering && (
              <p className="hint">
                スペース区切りはどれかに一致（例: <code>Chrome Edge</code>）。
                <code>/…/</code> で正規表現も使えます。下のボタンは表示中のファイルにだけ効きます。
              </p>
            )
          )}

          <div className="file-actions">
            <label className="switch">
              並び:
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="size">サイズ順</option>
                <option value="name">名前順</option>
              </select>
            </label>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy || visible.length === 0}
              onClick={() => onSetEnabled(filtering ? visible.map((s) => s.id) : null, true)}
            >
              {filtering ? `表示中を選択（${visible.length}）` : '全選択'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy || visible.length === 0}
              onClick={() => onSetEnabled(filtering ? visible.map((s) => s.id) : null, false)}
            >
              {filtering ? '表示中を解除' : '全解除'}
            </button>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              title="いまの選択状態（対象ファイル・検索カラム・日時カラム・絞り込み）を書き出します"
              onClick={onExportSelection}
            >
              選択を保存
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              title="書き出した選択状態を読み込んで、同じ対象範囲を再現します"
              onClick={() => selInputRef.current?.click()}
            >
              復元
            </button>
            <input
              ref={selInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={pickSelection}
            />
          </div>

          {visible.length === 0 ? (
            <p className="empty">絞り込みに一致するファイルがありません。</p>
          ) : (
            <ul className="file-list">
              {visible.map((f) => {
                const open = expanded === f.id;
                const selected = new Set(f.searchColumns);
                const partial = f.searchColumns.length < f.headers.length;
                const large = f.size >= LARGE_FILE_BYTES;
                return (
                  <li key={f.id} className={`file-item${open ? ' open' : ''}${f.enabled ? '' : ' disabled'}`}>
                    <div className="file-row">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        disabled={busy}
                        title="解析対象に含める"
                        onChange={(e) => onUpdate(f.id, { enabled: e.target.checked })}
                      />
                      <span
                        className="file-main"
                        onClick={() => setExpanded(open ? null : f.id)}
                        title={f.fileName}
                      >
                        <span className="chev">{open ? '▾' : '▸'}</span>
                        <span className="file-name">{f.fileName}</span>
                      </span>
                      <span className={`file-size mono${large ? ' large' : ''}`}>
                        {large && <span className="warn-dot" title="大容量ファイル">!</span>}
                        {formatBytes(f.size)}
                      </span>
                      <span className="muted file-meta">
                        {formatApproxCount(f.estimatedRows)} 行 / {f.headers.length} 列
                        {partial ? ` (検索 ${f.searchColumns.length})` : ''}
                      </span>
                      <button
                        type="button"
                        className="kw-del"
                        title="このファイルを外す"
                        disabled={busy}
                        onClick={() => onRemove(f.id)}
                      >
                        ×
                      </button>
                    </div>

                    {open && (
                      <div className="file-detail">
                        <div className="file-detail-head">
                          <span className="muted">検索対象カラム</span>
                          <div className="head-actions">
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => onUpdate(f.id, { searchColumns: [...f.headers] })}
                            >
                              全選択
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => onUpdate(f.id, { searchColumns: [] })}
                            >
                              全解除
                            </button>
                            {f.lowValueColumns.length > 0 && (
                              <button
                                className="btn btn-ghost btn-sm"
                                title={`数値・日時のみの列: ${f.lowValueColumns.join(', ')}`}
                                onClick={() =>
                                  onUpdate(f.id, {
                                    searchColumns: f.headers.filter(
                                      (h) => !f.lowValueColumns.includes(h),
                                    ),
                                  })
                                }
                              >
                                数値・日時のみの列を外す（{f.lowValueColumns.length}）
                              </button>
                            )}
                          </div>
                        </div>

                        {f.lowValueColumns.length > 0 && (
                          <p className="hint">
                            ○ 印は値が数値・日時のみの列です。検索から外すと軽くなりますが、
                            エラーコードのような数値を狙うキーワードは当たらなくなります。既定では外しません。
                          </p>
                        )}

                        <div className="chip-grid">
                          {f.headers.map((h) => (
                            <label key={h} className={`chip-check${selected.has(h) ? ' on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={selected.has(h)}
                                onChange={() => {
                                  const next = new Set(selected);
                                  if (next.has(h)) next.delete(h);
                                  else next.add(h);
                                  onUpdate(f.id, {
                                    searchColumns: f.headers.filter((x) => next.has(x)),
                                  });
                                }}
                              />
                              <span>
                                {f.lowValueColumns.includes(h) && <span className="lowval">○</span>}
                                {h}
                              </span>
                            </label>
                          ))}
                        </div>

                        <div className="ts-row">
                          <label>
                            日時カラム（表示用）:{' '}
                            <select
                              value={f.timestampColumn ?? ''}
                              onChange={(e) =>
                                onUpdate(f.id, { timestampColumn: e.target.value || null })
                              }
                            >
                              <option value="">（なし）</option>
                              {f.headers.map((h) => (
                                <option key={h} value={h}>
                                  {h}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
