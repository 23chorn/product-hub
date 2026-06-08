import type React from 'react';

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

interface InitiativeFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  titleInputRef: React.RefObject<HTMLInputElement>;
}

export function InitiativeForm({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  saving,
  onSubmit,
  onCancel,
  titleInputRef,
}: InitiativeFormProps) {
  return (
    <div className="mb-3 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Initiative name"
        className="w-full px-2 py-1.5 text-sm border border-teal-300 dark:border-teal-600 rounded focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mb-2"
      />
      <textarea
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full px-2 py-1.5 text-sm border border-teal-300 dark:border-teal-600 rounded focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-none mb-1"
      />
      <button
        type="button"
        onClick={() => { onTitleChange(SAMPLE_TITLE); onDescriptionChange(SAMPLE_DESCRIPTION); }}
        className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline mb-2 text-left"
      >
        Load demo sample
      </button>
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!title.trim() || saving}
          className="flex-1 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
