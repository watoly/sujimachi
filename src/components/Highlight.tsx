import { buildSegments } from '../lib/highlight';
import type { MatchHit } from '../types';

interface Props {
  value: string;
  hits: MatchHit[];
}

/** セル値のマッチ部分を <mark> でハイライトして描画する。 */
export function Highlight({ value, hits }: Props) {
  const segments = buildSegments(value, hits);
  return (
    <>
      {segments.map((s, i) =>
        s.mark ? (
          <mark key={i} className="hl">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
