import { useState } from 'react';
interface ExtendStagesPanelProps {
  stageSequence: string[];
  availableStages: Array<{ key: string; label: string; short: string }>;
  onExtend: (stages: string[]) => Promise<void>;
}

export function ExtendStagesPanel({
  stageSequence,
  availableStages,
  onExtend,
}: ExtendStagesPanelProps) {
  const [showExtendPanel, setShowExtendPanel] = useState(false);
  const [extendStages, setExtendStages] = useState<Record<string, boolean>>({});

  const addableStages = availableStages.filter(
    s => s.key !== 'curator' && !stageSequence.includes(s.key)
  );

  if (addableStages.length === 0) return null;

  const selected = addableStages.filter(s => extendStages[s.key]);

  if (!showExtendPanel) {
    return (
      <div className="flex justify-center">
        <button
          onClick={() => setShowExtendPanel(true)}
          className="text-xs px-2.5 py-1.5 rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-teal-300 dark:hover:border-teal-600 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
        >
          + Add stages
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Add stages to this workflow</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        New stages run after the existing output. Curator re-runs last to update context.
      </p>
      <div className="flex flex-wrap gap-2">
        {addableStages.map(s => (
          <button
            key={s.key}
            onClick={() => setExtendStages(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              extendStages[s.key]
                ? 'bg-teal-600 border-teal-600 text-white'
                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-teal-300 dark:hover:border-teal-600 hover:text-teal-600 dark:hover:text-teal-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={async () => {
            if (!selected.length) return;
            const orderedStages = availableStages
              .filter(s => extendStages[s.key])
              .map(s => s.key);
            await onExtend(orderedStages);
            setShowExtendPanel(false);
            setExtendStages({});
          }}
          disabled={selected.length === 0}
          className="flex-1 py-1.5 px-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs font-medium rounded-md transition-colors"
        >
          {selected.length === 0 ? 'Select stages above' : `Add ${selected.length} stage${selected.length !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={() => { setShowExtendPanel(false); setExtendStages({}); }}
          className="py-1.5 px-3 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
