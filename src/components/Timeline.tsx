import { useMemo, useRef, useState } from 'react';
import {
  bucketEnd,
  bucketStart,
  formatBucket,
  formatRange,
  pickScale,
  type Scale,
  type TimeRange,
} from '../lib/time';
import type { KeywordGroup, RowResult } from '../types';

/** 棒の本数の上限。細かすぎると 1 本が 1px になり読めない。 */
const MAX_BARS = 90;

interface Bucket {
  start: number;
  end: number;
  total: number;
  /** groups と同じ並びのグループ別件数 */
  counts: number[];
}

interface Props {
  /** 時間による絞り込みを掛ける前の結果。棒の高さが選択で変わらないようにするため。 */
  results: RowResult[];
  /** 行 → 日時。解釈できなかった行は入っていない。 */
  times: Map<RowResult, number>;
  groups: KeywordGroup[];
  range: TimeRange | null;
  onRangeChange: (r: TimeRange | null) => void;
}

export function Timeline({ results, times, groups, range, onRangeChange }: Props) {
  const [zoom, setZoom] = useState<TimeRange | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const groupIndex = new Map(groups.map((g, i) => [g.id, i]));

    // 1 巡目: 範囲と件数を掴む
    let min = Infinity;
    let max = -Infinity;
    let withTime = 0;
    let noTime = 0;
    let outside = 0;
    for (const r of results) {
      const t = times.get(r);
      if (t === undefined) {
        noTime++;
        continue;
      }
      if (zoom && (t < zoom.from || t >= zoom.to)) {
        outside++;
        continue;
      }
      withTime++;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (withTime === 0) {
      return { buckets: [] as Bucket[], scale: null as Scale | null, withTime, noTime, outside, peak: 0 };
    }

    const scale = pickScale(Math.max(max - min, 1), MAX_BARS);

    // バケットの器を先に作る（月・年は長さが一定でないので順に辿る）
    const buckets: Bucket[] = [];
    const indexByStart = new Map<number, number>();
    let cursor = bucketStart(min, scale);
    const lastStart = bucketStart(max, scale);
    for (;;) {
      const end = bucketEnd(cursor, scale);
      indexByStart.set(cursor, buckets.length);
      buckets.push({ start: cursor, end, total: 0, counts: new Array(groups.length).fill(0) });
      if (cursor >= lastStart || buckets.length >= MAX_BARS * 4) break;
      cursor = end;
    }

    // 2 巡目: 数える。グループは先頭（= グループ定義順で最上位）の 1 つに寄せる。
    // 複数グループに数えると積み上げの合計が行数と合わなくなるため。
    for (const r of results) {
      const t = times.get(r);
      if (t === undefined) continue;
      if (zoom && (t < zoom.from || t >= zoom.to)) continue;
      const i = indexByStart.get(bucketStart(t, scale));
      if (i === undefined) continue;
      const b = buckets[i];
      b.total++;
      const gi = groupIndex.get(r.groupIds[0]);
      if (gi !== undefined) b.counts[gi]++;
    }

    let peak = 0;
    for (const b of buckets) if (b.total > peak) peak = b.total;

    return { buckets, scale, withTime, noTime, outside, peak };
  }, [results, times, groups, zoom]);

  const { buckets, scale, noTime, outside, peak } = model;

  function indexAt(clientX: number): number {
    const el = chartRef.current;
    if (!el || buckets.length === 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(buckets.length - 1, Math.floor(ratio * buckets.length)));
  }

  function commit(a: number, b: number) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const next = { from: buckets[lo].start, to: buckets[hi].end };
    // 同じ範囲をもう一度押したら解除（クリックで付けて外せる）
    if (range && range.from === next.from && range.to === next.to) onRangeChange(null);
    else onRangeChange(next);
  }

  const preview = drag ? { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) } : null;

  return (
    <section className="timeline">
      <div className="tl-head">
        <h3>時系列</h3>
        {scale && (
          <span className="muted">
            {model.withTime.toLocaleString()} 件 / 1 目盛 {scaleLabel(scale)} / 最大{' '}
            {peak.toLocaleString()} 件
          </span>
        )}
        <div className="spacer" />
        {range && (
          <span className="tl-range" title="選択中の範囲">
            {scale ? formatRange(range, scale) : ''}
          </span>
        )}
        {range && (
          <button className="btn btn-ghost btn-sm" onClick={() => onRangeChange(null)}>
            範囲を解除
          </button>
        )}
        {range && (
          <button className="btn btn-ghost btn-sm" onClick={() => setZoom(range)}>
            範囲を拡大
          </button>
        )}
        {zoom && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setZoom(null);
              onRangeChange(null);
            }}
          >
            全体に戻す
          </button>
        )}
        <label className="switch sm" title="件数の差が大きいときに小さい山も見えるようにします">
          <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />
          対数
        </label>
      </div>

      {buckets.length === 0 ? (
        results.length === 0 ? (
          // 範囲や絞り込みで 0 件になった場合。見出しの「範囲を解除」は上に残るので、
          // ここでグラフが消えても操作に戻れる。
          <p className="hint">表示できる結果がありません。絞り込みを緩めてください。</p>
        ) : (
          <p className="hint">
            日時として読める値がありませんでした。左のファイル一覧で対象ファイルを開き、
            「日時カラム（表示用）」を指定すると時系列に並びます。
          </p>
        )
      ) : (
        <>
          <div
            className="tl-chart"
            ref={chartRef}
            onPointerDown={(e) => {
              const i = indexAt(e.clientX);
              setDrag({ a: i, b: i });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const i = indexAt(e.clientX);
              if (i !== drag.b) setDrag({ a: drag.a, b: i });
            }}
            onPointerUp={(e) => {
              if (drag) commit(drag.a, drag.b);
              setDrag(null);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {buckets.map((b, i) => {
              const inRange = preview
                ? i >= preview.lo && i <= preview.hi
                : range
                  ? b.start >= range.from && b.start < range.to
                  : false;
              const dimmed = (range !== null || preview !== null) && !inRange;
              return (
                <div
                  key={b.start}
                  className={`tl-slot${inRange ? ' sel' : ''}${dimmed ? ' dim' : ''}`}
                  title={`${formatBucket(b.start, scale!)}　${b.total.toLocaleString()} 件`}
                >
                  <div className="tl-bar" style={{ height: barHeight(b.total, peak, logScale) }}>
                    {groups.map((g, gi) =>
                      b.counts[gi] > 0 ? (
                        <div
                          key={g.id}
                          className="tl-seg"
                          style={{
                            flexGrow: b.counts[gi],
                            background: g.color,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tl-axis mono">
            <span>{formatBucket(buckets[0].start, scale!)}</span>
            {buckets.length > 2 && (
              <span>{formatBucket(buckets[Math.floor(buckets.length / 2)].start, scale!)}</span>
            )}
            <span>{formatBucket(buckets[buckets.length - 1].start, scale!)}</span>
          </div>

          <p className="tl-foot muted">
            棒をクリック、または左右にドラッグすると、その期間だけを下の表に表示します。
            {noTime > 0 && (
              <span className="tl-note">
                {' '}
                日時を読めない行が {noTime.toLocaleString()} 件あります（範囲を選ぶと表から外れます）。
              </span>
            )}
            {outside > 0 && (
              <span className="tl-note"> 拡大中のため、範囲外の {outside.toLocaleString()} 件はグラフに出ていません。</span>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function barHeight(v: number, peak: number, log: boolean): string {
  if (v <= 0 || peak <= 0) return '0';
  const ratio = log ? Math.log1p(v) / Math.log1p(peak) : v / peak;
  // 1 件でも見えるように下限を付ける
  return `${Math.max(3, ratio * 100)}%`;
}

function scaleLabel(s: Scale): string {
  if (s.unit === 'day' && s.step === 7) return '週';
  const unit = { minute: '分', hour: '時間', day: '日', month: 'か月', year: '年' }[s.unit];
  return `${s.step > 1 ? s.step : ''}${unit}`;
}
