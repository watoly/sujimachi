import { useEffect, useMemo, useRef, useState } from 'react';
import { FilePanel, type LoadProgress } from './components/FilePanel';
import { KeywordSummary } from './components/KeywordSummary';
import { KeywordSettings } from './components/KeywordSettings';
import { SummaryBar, type GroupFilter } from './components/SummaryBar';
import { ResultsTable } from './components/ResultsTable';
import { ProgressBar } from './components/ProgressBar';
import { KeywordStats } from './components/KeywordStats';
import { Timeline } from './components/Timeline';
import { isCsvFileName, readCsvSource } from './lib/csv';
import { buildMatcher, compileKeywords } from './lib/matcher';
import {
  analyzeSources,
  DEFAULT_LIMITS,
  RESULT_LIMIT_CHOICES,
  type AnalyzeProgress,
} from './lib/analyze';
import { loadKeywords, saveKeywords } from './lib/keywords';
import { loadGroups, saveGroups } from './lib/groups';
import { downloadText, exportResultsCsv, timestampForFile } from './lib/export';
import { applySelection, buildSelection, parseSelection, serializeSelection } from './lib/selection';
import { parseTimestamp, type TimeRange } from './lib/time';
import { formatBytes, formatDuration } from './lib/format';
import type { AnalyzeSummary, CsvSource, Keyword, KeywordGroup, RowResult } from './types';

type View = 'analyze' | 'keywords';
type SortOrder = 'file' | 'time-asc' | 'time-desc';

export default function App() {
  const [view, setView] = useState<View>('analyze');

  const [sources, setSources] = useState<CsvSource[]>([]);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [nameFilter, setNameFilter] = useState('');

  const [groups, setGroups] = useState<KeywordGroup[]>(() => loadGroups());
  const [keywords, setKeywords] = useState<Keyword[]>(() => loadKeywords());
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [resultLimit, setResultLimit] = useState(DEFAULT_LIMITS.maxResults);

  const [results, setResults] = useState<RowResult[] | null>(null);
  const [summary, setSummary] = useState<AnalyzeSummary | null>(null);
  const [regexErrors, setRegexErrors] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [dirty, setDirty] = useState(false);

  const [active, setActive] = useState<GroupFilter>('all');
  const [fileFilter, setFileFilter] = useState<string>('all');
  const [textFilter, setTextFilter] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('file');
  const [showTimeline, setShowTimeline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const cancelRef = useRef(false);

  useEffect(() => {
    saveKeywords(keywords);
  }, [keywords]);

  useEffect(() => {
    saveGroups(groups);
  }, [groups]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 10000);
    return () => clearTimeout(id);
  }, [notice]);

  // 解析し直したら時間の選択範囲は意味を失う
  useEffect(() => {
    setTimeRange(null);
  }, [results]);

  const skipDirty = useRef(true);
  useEffect(() => {
    if (skipDirty.current) {
      skipDirty.current = false;
      return;
    }
    if (results !== null) setDirty(true);
  }, [sources, keywords, caseSensitive, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddFiles(incoming: File[]) {
    const csvs = incoming.filter((f) => isCsvFileName(f.name));
    const skipped = incoming.length - csvs.length;
    if (csvs.length === 0) {
      setNotice('CSV ファイルが見つかりませんでした（拡張子 .csv のみ対象）。');
      return;
    }

    setLoadProgress({ done: 0, total: csvs.length });
    const loaded: CsvSource[] = [];
    const errors: string[] = [];
    for (let i = 0; i < csvs.length; i++) {
      try {
        loaded.push(await readCsvSource(csvs[i]));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      setLoadProgress({ done: i + 1, total: csvs.length });
      // 大量ファイル投入時に UI を固めない
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
    setLoadProgress(null);

    if (loaded.length > 0) {
      setSources((prev) => [...prev, ...loaded]);
      setFileFilter('all');
    }

    const bytes = loaded.reduce((a, s) => a + s.size, 0);
    const parts = [`${loaded.length} ファイル（${formatBytes(bytes)}）を読み込みました`];
    if (skipped > 0) parts.push(`CSV 以外 ${skipped} 件はスキップ`);
    if (errors.length > 0) parts.push(`読み込み失敗 ${errors.length} 件: ${errors[0]}`);
    parts.push('「解析実行」で全行を走査します');
    setNotice(parts.join('。') + '。');
  }

  function updateSource(
    id: string,
    patch: Partial<Pick<CsvSource, 'searchColumns' | 'timestampColumn' | 'enabled'>>,
  ) {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function handleRemove(id: string) {
    setSources((prev) => prev.filter((s) => s.id !== id));
    if (fileFilter === id) setFileFilter('all');
  }

  function handleClearAll() {
    setSources([]);
    setResults(null);
    setSummary(null);
    setRegexErrors({});
    setDirty(false);
    setFileFilter('all');
    setActive('all');
    setTextFilter('');
    setNameFilter('');
    setTimeRange(null);
    setSortOrder('file');
  }

  /** ids が null なら全件、配列ならその分だけ切り替える。 */
  function handleSetEnabled(ids: string[] | null, enabled: boolean) {
    if (ids === null) {
      setSources((prev) => prev.map((s) => ({ ...s, enabled })));
      return;
    }
    const target = new Set(ids);
    setSources((prev) => prev.map((s) => (target.has(s.id) ? { ...s, enabled } : s)));
  }

  function handleExportSelection() {
    if (sources.length === 0) {
      setNotice('書き出す対象がありません。先に CSV を読み込んでください。');
      return;
    }
    const sel = buildSelection(sources, nameFilter);
    downloadText(
      `sujimachi-selection_${timestampForFile()}.json`,
      serializeSelection(sel),
      'application/json;charset=utf-8',
    );
    setNotice(`${sources.length} ファイル分の選択状態を書き出しました。`);
  }

  async function handleImportSelection(file: File) {
    if (sources.length === 0) {
      setNotice('先に CSV を読み込んでから復元してください（ファイル名で対応づけます）。');
      return;
    }
    try {
      const sel = parseSelection(await file.text());
      const res = applySelection(sources, sel);
      setSources(res.sources);
      if (sel.nameFilter !== undefined) setNameFilter(sel.nameFilter);

      const parts = [`${res.applied} ファイルの選択状態を復元しました`];
      if (res.missing.length > 0) {
        parts.push(
          `設定にあるが読み込まれていないファイル ${res.missing.length} 件（例: ${res.missing[0]}）`,
        );
      }
      if (res.untouched > 0) {
        parts.push(`設定に無いファイル ${res.untouched} 件は現在の選択のままです`);
      }
      setNotice(parts.join('。') + '。');
    } catch (e) {
      setNotice(`選択状態を読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function runAnalysis() {
    if (analyzing) return;
    const targets = sources.filter((s) => s.enabled);
    if (targets.length === 0) {
      setNotice('解析対象のファイルが選択されていません。');
      return;
    }

    const { compiled, errors } = compileKeywords(keywords, caseSensitive);
    setRegexErrors(errors);
    const matcher = buildMatcher(compiled, caseSensitive);
    if (matcher.isEmpty) {
      setNotice('有効なキーワードがありません。「キーワード設定」で有効化してください。');
      return;
    }

    cancelRef.current = false;
    setAnalyzing(true);
    setResults(null);
    setSummary(null);
    setProgress({
      fileIndex: 0,
      fileCount: targets.length,
      fileName: targets[0].fileName,
      bytesProcessed: 0,
      bytesTotal: targets.reduce((a, s) => a + s.size, 0),
      rowsScanned: 0,
      matched: 0,
      stored: 0,
    });

    try {
      const { results: rows, summary: sum } = await analyzeSources({
        sources,
        matcher,
        groupOrder: groups.map((g) => g.id),
        maxResults: resultLimit,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
      setResults(rows);
      setSummary(sum);
      setDirty(false);
      skipDirty.current = true;

      const msgs: string[] = [];
      if (sum.cancelled) msgs.push('中断しました');
      if (sum.cappedByResults) {
        msgs.push(
          `${sum.matchedTotal.toLocaleString()} 件ヒットし、上限の ${sum.resultLimit.toLocaleString()} 件までを表示しています。走査自体は全ファイル完了しています。下の「キーワード別ヒット件数」で件数の多い語を外すと絞り込めます`,
        );
      }
      const failed = sum.fileStats.filter((f) => f.error);
      if (failed.length > 0) msgs.push(`${failed.length} ファイルの読み込みに失敗（${failed[0].error}）`);
      if (msgs.length > 0) setNotice(msgs.join('。') + '。');
    } catch (e) {
      setNotice(`解析中にエラーが発生しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  }

  function handleToggleGroup(groupId: string, enabled: boolean) {
    setKeywords((prev) => prev.map((k) => (k.groupId === groupId ? { ...k, enabled } : k)));
  }

  const sourcesById = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, CsvSource>,
    [sources],
  );

  const countsByGroup = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of groups) counts[g.id] = 0;
    if (!results) return counts;
    for (const r of results) {
      for (const id of r.groupIds) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [results, groups]);

  // 日時カラムの割り当てが変わったときだけ組み直す。
  // sourcesById は enabled を切り替えるだけでも変わるので、依存には使わない。
  const timestampKey = useMemo(
    () => sources.map((s) => `${s.id}:${s.timestampColumn ?? ''}`).join('|'),
    [sources],
  );

  const times = useMemo(() => {
    const map = new Map<RowResult, number>();
    if (!results) return map;
    const columnByFile = new Map(sources.map((s) => [s.id, s.timestampColumn]));
    for (const r of results) {
      const column = columnByFile.get(r.fileId);
      if (!column) continue;
      const t = parseTimestamp(r.row[column] ?? '');
      if (t !== null) map.set(r, t);
    }
    return map;
  }, [results, timestampKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 時間による絞り込みを掛ける前の結果。
   * 時系列グラフはこちらを見る（範囲を選ぶたびに棒が消えると比較にならないため）。
   */
  const beforeTimeFilter = useMemo(() => {
    if (!results) return [];
    const t = textFilter.trim().toLowerCase();
    return results.filter((r) => {
      if (active !== 'all' && !r.groupIds.includes(active)) return false;
      if (fileFilter !== 'all' && r.fileId !== fileFilter) return false;
      if (!t) return true;
      if (r.fileName.toLowerCase().includes(t)) return true;
      for (const h of r.hits) {
        if (h.term.toLowerCase().includes(t)) return true;
        if (h.column.toLowerCase().includes(t)) return true;
        const v = r.row[h.column];
        if (v && v.toLowerCase().includes(t)) return true;
      }
      return false;
    });
  }, [results, active, fileFilter, textFilter]);

  const filtered = useMemo(() => {
    let list = beforeTimeFilter;
    if (timeRange) {
      list = list.filter((r) => {
        const t = times.get(r);
        return t !== undefined && t >= timeRange.from && t < timeRange.to;
      });
    }
    if (sortOrder !== 'file') {
      const dir = sortOrder === 'time-asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const ta = times.get(a);
        const tb = times.get(b);
        // 日時が読めない行は、並び順にかかわらず末尾へ
        if (ta === undefined) return tb === undefined ? 0 : 1;
        if (tb === undefined) return -1;
        return (ta - tb) * dir;
      });
    }
    return list;
  }, [beforeTimeFilter, timeRange, sortOrder, times]);

  const enabledSources = sources.filter((s) => s.enabled);
  const enabledCount = keywords.filter((k) => k.enabled).length;
  const filesWithHits = useMemo(
    () => (summary ? summary.fileStats.filter((f) => f.matched > 0) : []),
    [summary],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">sujimachi</span>
          <span className="tagline">CSV キーワードマッチング</span>
        </div>
        <nav className="tabs" aria-label="画面切替">
          <button className={`tab${view === 'analyze' ? ' active' : ''}`} onClick={() => setView('analyze')}>
            解析
          </button>
          <button className={`tab${view === 'keywords' ? ' active' : ''}`} onClick={() => setView('keywords')}>
            キーワード設定
          </button>
        </nav>
        <div className="header-right">
          <span className="offline-badge" title="通信は行いません。CSV はブラウザ内でのみ処理されます。">
            ● オフライン処理
          </span>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
            閉じる
          </button>
        </div>
      )}

      {view === 'keywords' ? (
        <div className="page">
          <KeywordSettings
            keywords={keywords}
            groups={groups}
            onChange={setKeywords}
            onGroupsChange={setGroups}
            caseSensitive={caseSensitive}
            onCaseSensitiveChange={setCaseSensitive}
            regexErrors={regexErrors}
            onNotice={setNotice}
            onBack={() => setView('analyze')}
          />
        </div>
      ) : (
        <div className="layout">
          <aside className="controls">
            <FilePanel
              sources={sources}
              progress={loadProgress}
              busy={analyzing}
              nameFilter={nameFilter}
              onNameFilterChange={setNameFilter}
              onAddFiles={(fs) => void handleAddFiles(fs)}
              onRemove={handleRemove}
              onClearAll={handleClearAll}
              onUpdate={updateSource}
              onSetEnabled={handleSetEnabled}
              onExportSelection={handleExportSelection}
              onImportSelection={(f) => void handleImportSelection(f)}
            />
            <KeywordSummary
              keywords={keywords}
              groups={groups}
              onToggleGroup={handleToggleGroup}
              onOpenSettings={() => setView('keywords')}
            />
          </aside>

          <main className="results-area">
            {sources.length === 0 ? (
              <div className="placeholder">
                <p>左のパネルから CSV（複数可／フォルダ可）を読み込むと、ここに結果が表示されます。</p>
                <p className="muted">
                  読み込み時はヘッダーだけを確認し、全行の走査は「解析実行」時にストリーミングで行います。
                  数百 MB のファイルでもメモリに全行を載せません。
                </p>
              </div>
            ) : (
              <>
                <div className="run-bar">
                  <button className="btn btn-primary" onClick={() => void runAnalysis()} disabled={analyzing}>
                    {analyzing ? '解析中…' : '解析実行'}
                  </button>
                  <span className="muted">
                    {enabledSources.length} ファイル（
                    {formatBytes(enabledSources.reduce((a, s) => a + s.size, 0))}）/ 有効キーワード{' '}
                    {enabledCount} 件
                  </span>
                  {dirty && <span className="dirty">条件が変更されています。再解析してください。</span>}
                  <label className="switch" title="表示・保存する件数の上限。走査自体は常に全ファイル行います。">
                    表示上限:
                    <select
                      value={resultLimit}
                      disabled={analyzing}
                      onChange={(e) => setResultLimit(Number(e.target.value))}
                    >
                      {RESULT_LIMIT_CHOICES.map((n) => (
                        <option key={n} value={n}>
                          {n.toLocaleString()} 件
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="spacer" />
                  {results && (
                    <>
                      {filesWithHits.length > 1 && (
                        <select
                          className="file-select"
                          value={fileFilter}
                          onChange={(e) => setFileFilter(e.target.value)}
                          title="ファイルで絞り込み"
                        >
                          <option value="all">すべてのファイル</option>
                          {filesWithHits.map((f) => (
                            <option key={f.fileId} value={f.fileId}>
                              {f.fileName}（{f.matched.toLocaleString()}）
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        className="file-select"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                        title="表示順"
                      >
                        <option value="file">ファイル順</option>
                        <option value="time-asc">日時の古い順</option>
                        <option value="time-desc">日時の新しい順</option>
                      </select>
                      <label className="switch" title="時系列グラフの表示">
                        <input
                          type="checkbox"
                          checked={showTimeline}
                          onChange={(e) => setShowTimeline(e.target.checked)}
                        />
                        時系列
                      </label>
                      <input
                        className="filter-input"
                        type="search"
                        placeholder="結果を絞り込み（語・カラム・値・ファイル名）"
                        value={textFilter}
                        onChange={(e) => setTextFilter(e.target.value)}
                      />
                      <button
                        className="btn"
                        onClick={() => exportResultsCsv(sources, filtered, groups)}
                        disabled={filtered.length === 0}
                        title="表示中の結果を CSV で書き出し"
                      >
                        CSV 書き出し（{filtered.length.toLocaleString()}）
                      </button>
                    </>
                  )}
                </div>

                {progress && <ProgressBar progress={progress} onCancel={() => (cancelRef.current = true)} />}

                {summary && (
                  <p className="run-summary muted">
                    {summary.rowsScanned.toLocaleString()} 行 /{' '}
                    {formatBytes(summary.bytesProcessed)} を走査・{formatDuration(summary.elapsedMs)}
                    {summary.cappedByResults && (
                      <span className="dirty">
                        {' '}
                        — 全 {summary.matchedTotal.toLocaleString()} 件中、上限{' '}
                        {summary.resultLimit.toLocaleString()} 件を表示（走査は全ファイル完了）
                      </span>
                    )}
                    {summary.cancelled && (
                      <span className="dirty"> — 中断されたため、未走査のファイルがあります</span>
                    )}
                  </p>
                )}

                {summary && summary.keywordStats.length > 0 && (
                  <KeywordStats
                    stats={summary.keywordStats}
                    groups={groups}
                    totalRows={summary.matchedTotal}
                    needsNarrowing={summary.cappedByResults}
                    onDisable={(id, term) => {
                      setKeywords((prev) =>
                        prev.map((k) => (k.id === id ? { ...k, enabled: false } : k)),
                      );
                      setNotice(`「${term}」を無効にしました。再解析してください。`);
                    }}
                  />
                )}

                {results && (
                  <SummaryBar
                    totalRows={summary?.rowsScanned ?? 0}
                    matchedRows={results.length}
                    groups={groups}
                    countsByGroup={countsByGroup}
                    active={active}
                    onSelect={setActive}
                  />
                )}

                {results && results.length > 0 && showTimeline && (
                  <Timeline
                    results={beforeTimeFilter}
                    times={times}
                    groups={groups}
                    range={timeRange}
                    onRangeChange={setTimeRange}
                  />
                )}

                {results ? (
                  <ResultsTable sourcesById={sourcesById} groups={groups} results={filtered} />
                ) : (
                  !analyzing && <p className="empty">「解析実行」を押すと結果が表示されます。</p>
                )}
              </>
            )}
          </main>
        </div>
      )}

      <footer className="app-footer">
        <span>
sujimachi — 複数の CSV を横断してキーワードを探すオフラインツール。読み込んだデータは端末外に送信されません。
        </span>
      </footer>
    </div>
  );
}
