/**
 * 日時文字列の解釈と、時系列表示のための時間バケット計算。
 *
 * 重要な方針: タイムゾーンの変換は行わない。
 *
 * CSV の日時がどのタイムゾーンで書かれているかは、機械的に判別できない。
 * 同じ調査の中で UTC 表記のファイルと現地時刻のファイルが混ざることもある。
 * ここで勝手に変換すると「CSV に書いてある時刻」と「画面に出る時刻」がずれ、
 * 時系列の読み違いに直結する。
 *
 * そのため末尾の Z や +09:00 は解釈せず、書かれている数字をそのまま
 * 並べ替え・集計のキーとして使う。内部では UTC として組み立てるが、
 * これは「閲覧者のタイムゾーンによって結果が変わらないようにする」ためであって、
 * 値を UTC とみなしているわけではない。表示も元の文字列をそのまま出す。
 */

/** ISO 8601 風（2024-05-03 / 2024-05-03T12:34:56）。 */
const ISO_RE = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * 年が先（2024/05/03、2024.05.03、2024年5月3日）。
 * 「9時5分」のように分・秒が 1 桁で書かれることがあるので 1〜2 桁を許す。
 */
const YMD_RE =
  /^\s*(\d{4})[/.年](\d{1,2})[/.月](\d{1,2})日?(?:[T\s]+(\d{1,2})[:時](\d{1,2})(?:[:分](\d{1,2}))?)?/;

/**
 * 月日が先（05/03/2024）。月/日 の順とみなす。
 * 日/月 の順で書かれた CSV では月と日が入れ替わるが、
 * 表記だけからは判別できないため、より一般的な月/日 を採る。
 */
const MDY_RE =
  /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(AM|PM|午前|午後)?/i;

function build(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ampm?: string,
): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || mi > 59 || s > 59) return null;
  let hour = h;
  if (ampm) {
    const pm = /^(PM|午後)$/i.test(ampm);
    if (hour > 12) return null;
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  if (hour > 23) return null;
  const t = Date.UTC(y, mo - 1, d, hour, mi, s);
  // Date.UTC は 2 月 31 日のような値を繰り上げてしまうので、往復させて弾く
  const dt = new Date(t);
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

function num(v: string | undefined, fallback = 0): number {
  return v === undefined ? fallback : Number(v);
}

/**
 * 日時文字列を並べ替え可能な数値にする。解釈できなければ null。
 * 返る値は「書かれている数字を UTC として組み立てたもの」であり、実時刻ではない
 * （このファイル冒頭の方針を参照）。
 */
export function parseTimestamp(value: string): number | null {
  if (!value) return null;
  const v = value.length > 40 ? value.slice(0, 40) : value;

  let m = ISO_RE.exec(v);
  if (m) return build(+m[1], +m[2], +m[3], num(m[4]), num(m[5]), num(m[6]));

  m = YMD_RE.exec(v);
  if (m) return build(+m[1], +m[2], +m[3], num(m[4]), num(m[5]), num(m[6]));

  m = MDY_RE.exec(v);
  if (m) return build(+m[3], +m[1], +m[2], num(m[4]), num(m[5]), num(m[6]), m[7]);

  return null;
}

export type BucketUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface Scale {
  unit: BucketUnit;
  /** 1 バケットあたりの単位数（例: unit=hour, step=6 なら 6 時間刻み） */
  step: number;
}

/** 目盛りとして自然な刻みだけを候補にする（7 分刻みなどは読みにくい）。 */
const SCALES: Scale[] = [
  { unit: 'minute', step: 1 },
  { unit: 'minute', step: 5 },
  { unit: 'minute', step: 15 },
  { unit: 'minute', step: 30 },
  { unit: 'hour', step: 1 },
  { unit: 'hour', step: 3 },
  { unit: 'hour', step: 6 },
  { unit: 'hour', step: 12 },
  { unit: 'day', step: 1 },
  { unit: 'day', step: 7 },
  { unit: 'month', step: 1 },
  { unit: 'month', step: 3 },
  { unit: 'month', step: 6 },
  { unit: 'year', step: 1 },
  { unit: 'year', step: 2 },
  { unit: 'year', step: 5 },
  { unit: 'year', step: 10 },
  { unit: 'year', step: 25 },
  { unit: 'year', step: 50 },
  { unit: 'year', step: 100 },
];

/** バケット数の見積もりに使う概算の長さ（月・年は平均で足りる）。 */
const APPROX_MS: Record<BucketUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  month: 2_629_800_000,
  year: 31_557_600_000,
};

/**
 * 週バケットの起点。1970-01-01 は木曜なので、その前の月曜（1969-12-29）に合わせる。
 * こうしないと「週」の区切りが木曜始まりになり、日付として読みにくい。
 */
const WEEK_ANCHOR = -3 * 86_400_000;

/** 期間の長さから、棒の本数が maxBuckets 以下になる最小の刻みを選ぶ。 */
export function pickScale(spanMs: number, maxBuckets: number): Scale {
  for (const s of SCALES) {
    if (spanMs / (APPROX_MS[s.unit] * s.step) <= maxBuckets) return s;
  }
  return SCALES[SCALES.length - 1];
}

/** t を含むバケットの開始時刻。 */
export function bucketStart(t: number, scale: Scale): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  switch (scale.unit) {
    case 'minute': {
      const mi = d.getUTCMinutes();
      return Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), mi - (mi % scale.step));
    }
    case 'hour': {
      const h = d.getUTCHours();
      return Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), h - (h % scale.step));
    }
    case 'day': {
      if (scale.step === 1) return Date.UTC(y, d.getUTCMonth(), d.getUTCDate());
      const span = scale.step * 86_400_000;
      return Math.floor((t - WEEK_ANCHOR) / span) * span + WEEK_ANCHOR;
    }
    case 'month': {
      const mo = d.getUTCMonth();
      return Date.UTC(y, mo - (mo % scale.step));
    }
    case 'year': {
      // 年は負にならない想定だが、負の剰余で前方にずれないようにしておく
      const off = ((y % scale.step) + scale.step) % scale.step;
      return Date.UTC(y - off, 0);
    }
  }
}

/** バケットの終わり（= 次のバケットの開始、この値は含まない）。 */
export function bucketEnd(start: number, scale: Scale): number {
  const d = new Date(start);
  switch (scale.unit) {
    case 'minute':
      return start + scale.step * 60_000;
    case 'hour':
      return start + scale.step * 3_600_000;
    case 'day':
      return start + scale.step * 86_400_000;
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + scale.step);
    case 'year':
      return Date.UTC(d.getUTCFullYear() + scale.step, 0);
  }
}

function p2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** バケットの見出し。刻みに応じて必要な桁だけを出す。 */
export function formatBucket(start: number, scale: Scale): string {
  const d = new Date(start);
  const y = d.getUTCFullYear();
  const mo = p2(d.getUTCMonth() + 1);
  const day = p2(d.getUTCDate());
  switch (scale.unit) {
    case 'minute':
      return `${y}-${mo}-${day} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    case 'hour':
      return `${y}-${mo}-${day} ${p2(d.getUTCHours())}:00`;
    case 'day':
      return `${y}-${mo}-${day}`;
    case 'month':
      return `${y}-${mo}`;
    case 'year':
      return scale.step === 1 ? `${y}` : `${y}–${y + scale.step - 1}`;
  }
}

/** 分単位まで出す表示（選択範囲の見出し用）。 */
export function formatInstant(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(
    d.getUTCHours(),
  )}:${p2(d.getUTCMinutes())}`;
}

/** 選択された時間範囲。to は含まない。 */
export interface TimeRange {
  from: number;
  to: number;
}

export function formatRange(r: TimeRange, scale: Scale): string {
  const last = bucketStart(r.to - 1, scale);
  const a = formatBucket(r.from, scale);
  const b = formatBucket(last, scale);
  return a === b ? a : `${a} 〜 ${b}`;
}
