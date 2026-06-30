import type { ReactNode } from 'react';

// ── Shared visual primitives used across EpicFeaturesView, BacklogView, and
//    the tab shells — change here and every panel updates automatically. ──────

export function Chevron({ expanded, className = 'w-3.5 h-3.5 text-surface-400' }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`${className} flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function InitiativeHeader({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Initiative</span>
      <p className="text-base font-bold text-surface-900 dark:text-surface-100 truncate">{title}</p>
    </div>
  );
}

export function PhaseTag({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${colorClass}`}>{label}</span>
  );
}

// ── Tab shell — outer container shared by all three artifact panel views ──────

interface TabDef {
  id: string;
  label: string;
  count?: number;
}

interface ArtifactTabShellProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: ReactNode;
}

export function ArtifactTabShell({ tabs, activeTab, onTabChange, children }: ArtifactTabShellProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {tabs.length > 1 && (
        <div className="flex border-b border-surface-200 dark:border-surface-700 flex-shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-brand-600 dark:text-brand-400 border-b-2 border-brand-500'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'
              }`}
            >
              {tab.label}
              {tab.count != null && <span className="ml-1 opacity-60">({tab.count})</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {children}
      </div>
    </div>
  );
}
