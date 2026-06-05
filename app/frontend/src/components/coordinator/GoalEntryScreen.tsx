import { useState } from 'react';

export interface GoalEntryScreenProps {
  goal: string;
  onGoalChange: (value: string) => void;
  onSubmitGoal: (e: React.FormEvent) => void;
  error: string | null;
  isStreaming: boolean;
}

export function GoalEntryScreen({
  goal,
  onGoalChange,
  onSubmitGoal,
  error,
  isStreaming,
}: GoalEntryScreenProps) {
  const [showExample, setShowExample] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Product Hub</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
              className="w-full resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={!goal.trim() || isStreaming}
              className="w-full py-2.5 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Start
            </button>
          </form>

          <button
            onClick={() => setShowExample(v => !v)}
            className="w-full text-xs text-slate-400 dark:text-slate-500 hover:text-teal-500 dark:hover:text-teal-400 transition-colors text-center"
          >
            {showExample ? 'Hide example' : 'Show example of an ideal input'}
          </button>

          {showExample && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3 text-xs text-slate-600 dark:text-slate-400">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Example: high-quality goal input</p>
              <div className="bg-white dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-700 p-3 font-mono whitespace-pre-wrap leading-relaxed text-[11px]">{`Build a price alert and notification system for retail investors on the xCube mobile trading app.

**Who it's for:** Retail investors (ages 25–45) who actively monitor 5–20 positions and miss entry/exit opportunities because they can't watch prices throughout the day.

**Core problem:** Users currently set limit orders as a price-watching workaround, but those orders execute unintentionally. There is no way to be notified when a price threshold is crossed without committing to a trade — leading to missed opportunities and accidental fills.

**Key outcomes:**
- Users can set price alerts (above/below threshold) on any tradable instrument
- Push notifications delivered within 30 seconds of the trigger price being hit
- Reduce unintended limit order executions by 25%
- Re-engage dormant users by surfacing alerts that bring them back to trade

**Scope:** MVP — iOS and Android push notifications for equities and ETFs only. No options, no recurring alerts, no SMS. Alert history retained for 30 days.

**Constraints:**
- Notification copy must not imply investment advice (DFSA/regulatory requirement)
- Real-time price feed available via internal market data service (WebSocket, already in prod)
- Max 30-second delivery latency from trigger to device
- Team: 2 iOS, 2 Android, 2 backend engineers
- Target: ship within a single 6-week sprint cycle`}</div>
              <div className="space-y-1.5 pt-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">What makes this effective:</p>
                <ul className="space-y-1 list-none">
                  <li><span className="font-medium text-slate-700 dark:text-slate-300">Target user + pain</span> — who they are, what's broken today, quantified impact</li>
                  <li><span className="font-medium text-slate-700 dark:text-slate-300">Measurable outcomes</span> — success criteria the agents can design toward</li>
                  <li><span className="font-medium text-slate-700 dark:text-slate-300">Explicit scope boundary</span> — what's in v1, what's not</li>
                  <li><span className="font-medium text-slate-700 dark:text-slate-300">Real constraints</span> — regulatory, technical, team skills, budget, timeline</li>
                </ul>
                <p className="pt-1 text-slate-500 dark:text-slate-500 italic">
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
