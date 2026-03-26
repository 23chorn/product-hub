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
          className="text-xs px-2.5 py-1.5 rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          + Add stages
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Add stages to this workflow</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        New stages run after the existing output. Curator re-runs last to update context.
      </p>
      <div className="flex flex-wrap gap-2">
        {addableStages.map(s => (
          <button
            key={s.key}
            onClick={() => setExtendStages(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              extendStages[s.key]
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400'
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
          className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-xs font-medium rounded-md transition-colors"
        >
          {selected.length === 0 ? 'Select stages above' : `Add ${selected.length} stage${selected.length !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={() => { setShowExtendPanel(false); setExtendStages({}); }}
          className="py-1.5 px-3 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
