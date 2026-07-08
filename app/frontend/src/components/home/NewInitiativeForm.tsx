import type { RefObject } from 'react';
import { splitProductAreas } from '../../utils/product-area';

/** Fixed product-area options for the New Initiative form's checkboxes. */
const PRODUCT_AREA_OPTIONS = ['Mobile App', 'Web App'];

/** Toggle `option` in the comma-joined productArea string, keeping PRODUCT_AREA_OPTIONS order. */
function toggleProductArea(current: string, option: string): string {
  const selected = new Set(splitProductAreas(current));
  if (selected.has(option)) selected.delete(option); else selected.add(option);
  return PRODUCT_AREA_OPTIONS.filter(o => selected.has(o)).join(', ');
}

/** Fixed strategic-theme options for the New Initiative form's dropdown. */
const STRATEGIC_THEME_OPTIONS = [
  'CX & Product Value',
  'Assets & Market Share',
  'Platform & Scalability',
  'Risk, Compliance & Trust',
];

interface NewInitiativeFormProps {
  title: string;
  description: string;
  productArea: string;
  strategicTheme: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onProductAreaChange: (v: string) => void;
  onStrategicThemeChange: (v: string) => void;
  saving: boolean;
  onCreate: () => void;
  onCancel: () => void;
  titleInputRef: RefObject<HTMLInputElement>;
}

/** Inline form for creating a new initiative. */
export function NewInitiativeForm({
  title,
  description,
  productArea,
  strategicTheme,
  onTitleChange,
  onDescriptionChange,
  onProductAreaChange,
  onStrategicThemeChange,
  saving,
  onCreate,
  onCancel,
  titleInputRef,
}: NewInitiativeFormProps) {
  return (
    <div className="p-4 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/60 dark:bg-brand-900/20 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">New Initiative</p>
        <button onClick={onCancel} className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300">
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
        className="w-full px-3 py-2 text-sm border border-brand-300 dark:border-brand-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400"
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 px-3 py-2 border border-brand-300 dark:border-brand-600 rounded-lg bg-white dark:bg-surface-800">
          {PRODUCT_AREA_OPTIONS.map(opt => {
            const checked = splitProductAreas(productArea).includes(opt);
            return (
              <label key={opt} className="flex items-center gap-1.5 text-sm text-surface-900 dark:text-surface-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onProductAreaChange(toggleProductArea(productArea, opt))}
                  className="rounded border-brand-300 dark:border-brand-600 text-brand-600 focus:ring-brand-500"
                />
                {opt}
              </label>
            );
          })}
        </div>
        <select
          value={strategicTheme}
          onChange={e => onStrategicThemeChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-brand-300 dark:border-brand-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
        >
          <option value="" disabled>Strategic theme</option>
          {STRATEGIC_THEME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
      <textarea
        value={description}
        onChange={e => onDescriptionChange(e.target.value)}
        placeholder={`Describe the initiative in detail — who it's for, the core problem, key outcomes, scope, and constraints.\n\nThe richer the description, the less the coordinator needs to ask.`}
        rows={6}
        className="w-full px-3 py-2 text-sm border border-brand-300 dark:border-brand-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder-surface-400 resize-none"
      />
      <div className="flex gap-2">
        <button
          onClick={onCreate}
          disabled={!title.trim() || !productArea || !strategicTheme || saving}
          className="flex-1 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs font-medium bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
