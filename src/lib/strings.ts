/**
 * 文字列を「親から切り離した独立した実体」として作り直す。
 *
 * === この関数を消してはいけない理由 ===
 *
 * V8 の substring / slice は「スライス文字列」を返し、切り出し元の文字列全体への
 * 参照を保持し続ける。PapaParse は数 MB のチャンク文字列からセル値を substring で
 * 切り出すため、マッチした 1 行を保持するだけでそのチャンク全体（数 MB）が
 * 解放されなくなる。数百 MB の CSV を走査するとヒープが GB 級まで膨らみ、
 * 実際 825MB の走査でピーク 1.7GB、完了後も 721MB が居座っていた。
 *
 * 実測（30 文字の部分文字列を 60 個保持した場合の保持量）:
 *   素朴に保持            67 MB   ← 親チャンクごと生き残る
 *   (s + ' ').slice(0,-1)  0.02 MB
 *   JSON.parse/stringify   0.02 MB だが約 2 倍遅い
 *
 * 連結すると V8 は ConsString を作り、slice の際に一度平坦化するため、
 * 元のチャンクへの参照が切れる。「無意味な連結」に見えるが最適化してはならない。
 */
export function detachString(s: string): string {
  return s.length === 0 ? '' : (s + ' ').slice(0, -1);
}

/** 行オブジェクトの全セルを親チャンクから切り離す。 */
export function detachRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k in row) out[k] = detachString(row[k]);
  return out;
}
