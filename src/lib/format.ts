export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${Math.round(s - m * 60)} 秒`;
}

/** 概数（推定行数など、正確さより桁感が大事な場面用）。 */
export function formatApproxCount(n: number): string {
  if (n < 10000) return n.toLocaleString();
  if (n < 1000000) return `約 ${Math.round(n / 1000).toLocaleString()} 千`;
  return `約 ${(n / 1000000).toFixed(1)} 百万`;
}
