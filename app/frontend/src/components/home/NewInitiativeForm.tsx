import type { RefObject } from 'react';

const SAMPLE_TITLE = 'Price Alerts & Watchlist — TradeEasy';
const SAMPLE_DESCRIPTION = `Build a price alert and notification system for retail investors on the TradeEasy mobile trading app.

Who it's for: Retail investors (ages 25–45) who actively monitor 5–20 positions and miss entry/exit opportunities because they can't watch prices throughout the day.

Core problem: Users currently set limit orders as a price-watching workaround, but those orders execute unintentionally. There is no way to be notified when a price threshold is crossed without committing to a trade.

Key outcomes:
- Users can set price alerts (above/below threshold) on any tradable instrument
- Push notifications delivered within 30 seconds of the trigger price being hit
- Reduce unintended limit order executions by 25%

Scope: MVP — iOS and Android push notifications for equities and ETFs only. No options, no recurring alerts. Alert history retained for 30 days.

Constraints:
- Notification copy must not imply investment advice (regulatory requirement)
- Real-time price feed available via internal WebSocket market data service
- Max 30-second delivery latency from trigger to device
- Team: 2 iOS, 2 Android, 2 backend engineers`;

interface NewInitiativeFormProps {
  title: string;
  description: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  saving: boolean;
  onCreate: () => void;
  onCancel: () => void;
  titleInputRef: RefObject<HTMLInputElement>;
}

/** Inline form for creating a new initiative, with a "load demo sample" shortcut. */
export function NewInitiativeForm({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  saving,
  onCreate,
  onCancel,
  titleInputRef,
}: NewInitiativeFormProps) {
  return (
    <div className="p-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">New Initiative</p>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        placeholder="Initiative name"
        className="w-full px-3 py-2 text-sm border border-teal-300 dark:border-teal-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400"
      />
      <textarea
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        placeholder={`Describe the initiative in detail — who it's for, the core problem, key outcomes, scope, and constraints.\n\nThe richer the description, the less the coordinator needs to ask.`}
        rows={6}
        className="w-full px-3 py-2 text-sm border border-teal-300 dark:border-teal-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 resize-none"
      />
      <button
        type="button"
        onClick={() => { onTitleChange(SAMPLE_TITLE); onDescriptionChange(SAMPLE_DESCRIPTION); }}
        className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
      >
        Load demo sample
      </button>
      <div className="flex gap-2">
        <button
          onClick={onCreate}
          disabled={!title.trim() || saving}
          className="flex-1 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
