// ドメイン型定義

/**
 * キーワードの分類グループ。ユーザーが自由に定義できる。
 * 数も名前も固定しない（用途ごとに「重要 / 注意」だったり
 * 「製品A / 製品B / 製品C」だったりするため）。
 */
export interface KeywordGroup {
  id: string;
  name: string;
  /** バッジやバーに使う色（CSS カラー文字列） */
  color: string;
}

/** 1 件のキーワード。必ずいずれかのグループに属する。 */
export interface Keyword {
  id: string;
  groupId: string;
  term: string;
  /** true の場合 term を正規表現として扱う */
  isRegex: boolean;
  /**
   * true の場合、単語単位でのみ一致させる（isRegex が true のときは無視）。
   * 「LINE」が online / deadline に当たるような誤検知を抑える。
   * 境界の定義は matcher.ts を参照。既存の保存データに無い場合があるため省略可。
   */
  wholeWord?: boolean;
  /** マッチ対象に含めるか */
  enabled: boolean;
}

/**
 * 読み込み対象の CSV 1 ファイル。
 *
 * 重要: 行データは保持しない。数百万行の CSV を全行オブジェクト化すると
 * タブのメモリ上限を超えて落ちるため、File ハンドルだけを持ち、
 * 解析時にストリーミングで読み直す。ここに載るのはヘッダーと、
 * 列の性質を判定するための先頭サンプルのみ。
 */
export interface CsvSource {
  id: string;
  file: File;
  fileName: string;
  /** バイト数 */
  size: number;
  headers: string[];
  /** 先頭から読んだサンプル行（列の性質判定・日時カラム推測に使う） */
  sampleRows: Record<string, string>[];
  /** ファイルサイズとサンプルから推定した総行数 */
  estimatedRows: number;
  /** 検索対象カラム（既定: 全カラム） */
  searchColumns: string[];
  /** 結果表示に使う日時カラム */
  timestampColumn: string | null;
  /**
   * 「数値のみ」「日時のみ」など、キーワード検索の価値が低いと推定された列。
   * 自動では除外しない（黙って検索範囲を狭めると取りこぼすため）。
   * UI 上で明示的に除外するためのヒントとしてのみ使う。
   */
  lowValueColumns: string[];
  /** 解析対象に含めるか */
  enabled: boolean;
}

/** 1 セル内の 1 マッチ。start/end は元のセル値に対する文字オフセット。 */
export interface MatchHit {
  groupId: string;
  keywordId: string;
  term: string;
  column: string;
  start: number;
  end: number;
}

/** マッチした 1 行分の結果。 */
export interface RowResult {
  fileId: string;
  fileName: string;
  /** そのファイル内での行番号（0 始まり） */
  rowIndex: number;
  row: Record<string, string>;
  hits: MatchHit[];
  /** この行がヒットしたグループ（重複なし・定義順） */
  groupIds: string[];
  /** 1 行あたりのヒット上限に達して打ち切られた */
  truncated?: boolean;
}

/** ファイル単位の解析統計。 */
export interface FileStat {
  fileId: string;
  fileName: string;
  rowsScanned: number;
  matched: number;
  /** 読み込みに失敗した場合の理由 */
  error?: string;
  /** 解析されずに終わった（中断・除外） */
  skipped?: boolean;
}

/** キーワード 1 件が何行にヒットしたか。絞り込みの手がかりに使う。 */
export interface KeywordStat {
  keywordId: string;
  term: string;
  groupId: string;
  /** ヒットした行数（同じ行に同じ語が複数回出ても 1 と数える） */
  rows: number;
}

/** 解析結果全体のサマリー。 */
export interface AnalyzeSummary {
  rowsScanned: number;
  /** 実際に保存・表示された件数 */
  matched: number;
  /** 見つかったヒット行の総数（保存上限を超えた分も含む） */
  matchedTotal: number;
  bytesProcessed: number;
  bytesTotal: number;
  /** 保存上限を超えた（= matchedTotal > matched） */
  cappedByResults: boolean;
  /** そのときの保存上限 */
  resultLimit: number;
  /** ユーザーが中断した */
  cancelled: boolean;
  elapsedMs: number;
  fileStats: FileStat[];
  /** ヒット行数の多い順 */
  keywordStats: KeywordStat[];
}
