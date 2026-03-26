import { useState } from 'react';

export interface GoalEntryScreenProps {
  goal: string;
  onGoalChange: (value: string) => void;
  onSubmitGoal: (e: React.FormEvent) => void;
  availableStages: Array<{ key: string; label: string; short: string }>;
  enabledStages: Record<string, boolean>;
  onToggleStage: (key: string) => void;
  error: string | null;
  isStreaming: boolean;
}

export function GoalEntryScreen({
  goal,
  onGoalChange,
  onSubmitGoal,
  availableStages,
  enabledStages,
  onToggleStage,
  error,
  isStreaming,
}: GoalEntryScreenProps) {
  const [showExample, setShowExample] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Product Hub</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Describe what you want to build. The Chief of Staff will gather details and run the pipeline.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start p-8">
        <div className="w-full max-w-lg space-y-4">
          <form onSubmit={onSubmitGoal} className="space-y-3">
            <textarea
              value={goal}
              onChange={(e) => onGoalChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmitGoal(e as any); }
              }}
              placeholder={'What do you want to build?\n\nInclude: who it\'s for, the core problem, key outcomes, scope, and any constraints.'}
              rows={7}
              className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {/* Stage toggles */}
            <div className="flex flex-wrap gap-1.5">
              {availableStages.map(stage => {
                const enabled = enabledStages[stage.key];
                const enabledCount = Object.values(enabledStages).filter(Boolean).length;
                const isLastEnabled = enabled && enabledCount === 1;
                return (
                  <button
                    key={stage.key}
                    type="button"
                    disabled={isLastEnabled}
                    onClick={() => onToggleStage(stage.key)}
                    title={isLastEnabled ? 'At least one stage required' : `${enabled ? 'Disable' : 'Enable'} ${stage.label}`}
                    className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                      enabled
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 line-through'
                    } ${isLastEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'}`}
                  >
                    {stage.short}
                  </button>
                );
              })}
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={!goal.trim() || isStreaming}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Start
            </button>
          </form>

          <button
            onClick={() => setShowExample(v => !v)}
            className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors text-center"
          >
            {showExample ? 'Hide example' : 'Show example of an ideal input'}
          </button>

          {showExample && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3 text-xs text-gray-600 dark:text-gray-400">
              <p className="font-semibold text-gray-700 dark:text-gray-300">Example: high-quality goal input</p>
              <div className="bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 p-3 font-mono whitespace-pre-wrap leading-relaxed text-[11px]">{`Build a real-time dashboard for fleet managers at mid-size logistics companies (50–500 vehicles) that consolidates GPS tracking, fuel consumption, and maintenance alerts into a single view.

**Who it's for:** Fleet operations managers who currently juggle 3–4 separate tools and lose 2+ hours/day reconciling data.

**Core problem:** No unified view of vehicle health, location, and cost — leading to missed maintenance windows, route inefficiencies, and fuel waste.

**Key outcomes:**
- Reduce vehicle downtime by 20% through predictive maintenance alerts
- Cut fuel spend by 10% via route optimization suggestions
- Single pane of glass replacing Samsara + Google Sheets + email alerts

**Scope:** MVP — web app only, 3 integrations (GPS provider API, fuel card API, OBD-II adapter). No mobile app in v1.

**Constraints:**
- Must comply with DOT electronic logging regulations
- Max 2-second latency on real-time position updates
- Team has React/Node experience, open to Postgres or TimescaleDB
- Budget: \$150k, target launch in 12 weeks`}</div>
              <div className="space-y-1.5 pt-1">
                <p className="font-semibold text-gray-700 dark:text-gray-300">What makes this effective:</p>
                <ul className="space-y-1 list-none">
                  <li><span className="font-medium text-gray-700 dark:text-gray-300">Target user + pain</span> — who they are, what's broken today, quantified impact</li>
                  <li><span className="font-medium text-gray-700 dark:text-gray-300">Measurable outcomes</span> — success criteria the agents can design toward</li>
                  <li><span className="font-medium text-gray-700 dark:text-gray-300">Explicit scope boundary</span> — what's in v1, what's not</li>
                  <li><span className="font-medium text-gray-700 dark:text-gray-300">Real constraints</span> — regulatory, technical, team skills, budget, timeline</li>
                </ul>
                <p className="pt-1 text-gray-500 dark:text-gray-500 italic">
                  Tip: you don't need all of this upfront — the Chief of Staff will ask clarifying questions. But the more context you provide, the fewer rounds of Q&A and the better the outputs.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
