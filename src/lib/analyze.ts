import Papa from 'papaparse';
import type { AnalyzeSummary, CsvSource, FileStat, KeywordStat, RowResult } from '../types';
import { matchRow, type Matcher } from './matcher';
import { detachRow } from './strings';

/**
 * 既定の上限値。
 *
 * maxResults: 「保存して画面に出す」件数の上限。人が目視できる量を超えたら
 *   キーワードが広すぎるので、保存は打ち切る。ただし走査自体は止めない（後述）。
 * maxHitsPerRow: 1 セルに同じ語が数百回出るような行で MatchHit が爆発するのを防ぐ。
 * chunkBytes: 1 チャンクの同期処理を 100ms 程度に収めるための粒度。
 *   Papa は File をチャンク単位に非同期で読むため、チャンクの切れ目で
 *   イベントループが回り、進捗描画と中断操作を受け付けられる。
 */
export const DEFAULT_LIMITS = {
  maxResults: 50000,
  maxHitsPerRow: 20,
  chunkBytes: 2 * 1024 * 1024,
};

export const RESULT_LIMIT_CHOICES = [10000, 50000, 100000, 300000];

export interface AnalyzeProgress {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  bytesProcessed: number;
  bytesTotal: number;
  rowsScanned: number;
  /** 見つかったヒット行数（保存上限を超えた分も含む） */
  matched: number;
  /** 実際に保存された件数 */
  stored: number;
}

export interface AnalyzeOptions {
  sources: CsvSource[];
  matcher: Matcher;
  /** グループ定義の並び順（バッジの表示順に使う） */
  groupOrder: string[];
  maxResults?: number;
  maxHitsPerRow?: number;
  chunkBytes?: number;
  onBatch?: (rows: RowResult[]) => void;
  onProgress?: (p: AnalyzeProgress) => void;
  /** true を返すと中断する */
  shouldCancel?: () => boolean;
}

export interface AnalyzeResult {
  results: RowResult[];
  summary: AnalyzeSummary;
}

interface FileOutcome {
  stat: FileStat;
  cancelled: boolean;
  bytesProcessed: number;
}

interface FileCtx {
  matcher: Matcher;
  groupOrder: string[];
  results: RowResult[];
  /** keywordId → ヒットした行数 */
  keywordHitRows: Map<string, number>;
  maxResults: number;
  maxHitsPerRow: number;
  chunkBytes: number;
  bytesBefore: number;
  bytesTotal: number;
  fileIndex: number;
  fileCount: number;
  rowsScannedBefore: number;
  matchedBefore: number;
  onBatch?: (rows: RowResult[]) => void;
  onProgress?: (p: AnalyzeProgress) => void;
  shouldCancel?: () => boolean;
}

/**
 * 1 ファイルをストリーミングで走査する。
 * 全行をメモリに載せず、マッチした行だけを results に積む。
 *
 * 保存上限に達しても走査は止めない。止めてしまうと「そのファイル以降を
 * 一切見ていない」状態になり、結果に取りこぼしの範囲ができてしまう。
 * 上限後は保存だけをやめ、件数の集計は続ける。
 */
function analyzeFile(source: CsvSource, ctx: FileCtx): Promise<FileOutcome> {
  return new Promise((resolve) => {
    let rowsScanned = 0;
    let matched = 0;
    let cancelled = false;
    let bytesProcessed = 0;
    let settled = false;

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      resolve({
        stat: { fileId: source.id, fileName: source.fileName, rowsScanned, matched, error },
        cancelled,
        bytesProcessed: error ? source.size : bytesProcessed,
      });
    };

    Papa.parse<Record<string, string>>(source.file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      transformHeader: (h) => (h.charCodeAt(0) === 0xfeff ? h.slice(1) : h).trim(),
      chunkSize: ctx.chunkBytes,
      chunk: (results, parser) => {
        if (ctx.shouldCancel?.()) {
          cancelled = true;
          parser.abort();
          return;
        }

        const batch: RowResult[] = [];
        const rows = results.data;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const m = matchRow(row, source.searchColumns, ctx.matcher, ctx.maxHitsPerRow, ctx.groupOrder);
          if (!m) continue;

          matched++;

          // キーワード別の集計は上限に関係なく続ける。
          // これが「どの語が件数を稼いでいるか」を知る唯一の手がかりになる。
          const counted = new Set<string>();
          for (const h of m.hits) {
            if (counted.has(h.keywordId)) continue;
            counted.add(h.keywordId);
            ctx.keywordHitRows.set(h.keywordId, (ctx.keywordHitRows.get(h.keywordId) ?? 0) + 1);
          }

          if (ctx.results.length + batch.length < ctx.maxResults) {
            batch.push({
              fileId: source.id,
              fileName: source.fileName,
              rowIndex: rowsScanned + i,
              // detachRow を通さないと、この 1 行を保持するだけで
              // 数 MB のチャンク文字列全体が解放されなくなる（strings.ts 参照）
              row: detachRow(row),
              hits: m.hits,
              groupIds: m.groupIds,
              truncated: m.truncated || undefined,
            });
          }
        }

        rowsScanned += rows.length;
        if (batch.length > 0) {
          for (const r of batch) ctx.results.push(r);
          ctx.onBatch?.(batch);
        }

        // meta.cursor はファイル先頭からの読み込み済みバイト数
        bytesProcessed = results.meta.cursor ?? bytesProcessed;
        ctx.onProgress?.({
          fileIndex: ctx.fileIndex,
          fileCount: ctx.fileCount,
          fileName: source.fileName,
          bytesProcessed: ctx.bytesBefore + bytesProcessed,
          bytesTotal: ctx.bytesTotal,
          rowsScanned: ctx.rowsScannedBefore + rowsScanned,
          matched: ctx.matchedBefore + matched,
          stored: ctx.results.length,
        });
      },
      complete: () => finish(),
      error: (err: Error) => finish(err.message),
    });
  });
}

/** 複数ファイルを順に走査する。中断されない限り全ファイルを見る。 */
export async function analyzeSources(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const {
    sources,
    matcher,
    groupOrder,
    maxResults = DEFAULT_LIMITS.maxResults,
    maxHitsPerRow = DEFAULT_LIMITS.maxHitsPerRow,
    chunkBytes = DEFAULT_LIMITS.chunkBytes,
    onBatch,
    onProgress,
    shouldCancel,
  } = options;

  const started = Date.now();
  const targets = sources.filter((s) => s.enabled && s.searchColumns.length > 0);
  const bytesTotal = targets.reduce((a, s) => a + s.size, 0);

  const results: RowResult[] = [];
  const keywordHitRows = new Map<string, number>();
  const fileStats: FileStat[] = [];
  let bytesProcessed = 0;
  let rowsScanned = 0;
  let matchedTotal = 0;
  let cancelled = false;

  for (let i = 0; i < targets.length; i++) {
    const source = targets[i];

    if (cancelled || shouldCancel?.()) {
      cancelled = true;
      fileStats.push({
        fileId: source.id,
        fileName: source.fileName,
        rowsScanned: 0,
        matched: 0,
        skipped: true,
      });
      continue;
    }

    const outcome = await analyzeFile(source, {
      matcher,
      groupOrder,
      results,
      keywordHitRows,
      maxResults,
      maxHitsPerRow,
      chunkBytes,
      bytesBefore: bytesProcessed,
      bytesTotal,
      fileIndex: i,
      fileCount: targets.length,
      rowsScannedBefore: rowsScanned,
      matchedBefore: matchedTotal,
      onBatch,
      onProgress,
      shouldCancel,
    });

    fileStats.push(outcome.stat);
    bytesProcessed += outcome.bytesProcessed;
    rowsScanned += outcome.stat.rowsScanned;
    matchedTotal += outcome.stat.matched;
    if (outcome.cancelled) cancelled = true;
  }

  // 対象外にしたファイルも統計に残す（どのファイルを見ていないかを明示するため）
  for (const s of sources) {
    if (!fileStats.some((f) => f.fileId === s.id)) {
      fileStats.push({
        fileId: s.id,
        fileName: s.fileName,
        rowsScanned: 0,
        matched: 0,
        skipped: true,
      });
    }
  }

  const keywordStats: KeywordStat[] = [];
  for (const kw of matcher.byPatternId.concat(matcher.regexes)) {
    const rows = keywordHitRows.get(kw.id) ?? 0;
    if (rows > 0) {
      keywordStats.push({ keywordId: kw.id, term: kw.term, groupId: kw.groupId, rows });
    }
  }
  keywordStats.sort((a, b) => b.rows - a.rows);

  return {
    results,
    summary: {
      rowsScanned,
      matched: results.length,
      matchedTotal,
      bytesProcessed,
      bytesTotal,
      cappedByResults: matchedTotal > results.length,
      resultLimit: maxResults,
      cancelled,
      elapsedMs: Date.now() - started,
      fileStats,
      keywordStats,
    },
  };
}
