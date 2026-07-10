import type { CoordinatorMessage } from '../../../stores/workflowStore';

interface Props {
  msg: CoordinatorMessage;
  /** 0-based feature index → feature title, so members can show "F2 — Payment retry" instead of just "F2". */
  featureNames: string[];
}

/**
 * Section header for an entire parallel refinement wave — shown once, before the
 * first feature's own StageGroupHeader, so wave-level info (which features are
 * running together) reads as its own block instead of being folded into that
 * feature's event list, as if it were F1-specific narration.
 */
export function WaveGroupHeader({ msg, featureNames }: Props) {
  const details = msg.details ?? {};
  const waveIndex = typeof details.waveIndex === 'number' ? details.waveIndex : undefined;
  const waveCount = typeof details.waveCount === 'number' ? details.waveCount : undefined;
  const members = Array.isArray(details.members) ? (details.members as string[]) : [];
  const label = waveIndex ? `Refinement Wave ${waveIndex}${waveCount ? ` of ${waveCount}` : ''}` : 'Refinement Wave';

  const memberLabels = members.map(stage => {
    const match = stage.match(/_F(\d+)$/);
    const fKey = match ? `F${match[1]}` : stage;
    const name = match ? featureNames[Number(match[1]) - 1] : undefined;
    return name ? `${fKey} — ${name}` : fKey;
  });

  return (
    <div className="mt-4 pt-3 border-t-2 border-dashed border-surface-300 dark:border-surface-700">
      <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse inline-block" />
        <span>{label}</span>
      </div>
      {memberLabels.length > 0 && (
        <div className="px-2 pb-1.5 text-[11px] font-mono text-surface-500 dark:text-surface-400">
          {memberLabels.length} features running in parallel: {memberLabels.join(', ')}
        </div>
      )}
    </div>
  );
}
