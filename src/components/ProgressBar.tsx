import { formatBytes } from '../lib/format';
import type { AnalyzeProgress } from '../lib/analyze';

interface Props {
  progress: AnalyzeProgress;
  onCancel: () => void;
}

export function ProgressBar({ progress, onCancel }: Props) {
  const pct =
    progress.bytesTotal > 0
      ? Math.min(100, (progress.bytesProcessed / progress.bytesTotal) * 100)
      : 0;

  return (
    <div className="analyze-progress">
      <div className="ap-head">
        <span className="ap-title">解析中…</span>
        <span className="muted mono">
          {progress.fileIndex + 1}/{progress.fileCount} — {progress.fileName}
        </span>
        <div className="spacer" />
        <span className="muted mono">
          {formatBytes(progress.bytesProcessed)} / {formatBytes(progress.bytesTotal)}（
          {pct.toFixed(0)}%）・{progress.rowsScanned.toLocaleString()} 行走査・
          {progress.matched.toLocaleString()} 件ヒット
        </span>
        <button className="btn btn-sm" onClick={onCancel}>
          中断
        </button>
      </div>
      <div className="ap-track">
        <div className="ap-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
