import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import type { CompletedInitiativeDetail, CompletedInitiativeWorkItemRow } from '@pap/shared';
import { api } from '../../services/api';
import { WORK_ITEM_STATE_BUCKET_COLORS, WORK_ITEM_STATE_BUCKET_LABELS } from '../../utils/work-item-state-bucket';

interface Props {
  items: CompletedInitiativeWorkItemRow[];
  itemId: string;
  archived: boolean;
  onUpdate: (updated: CompletedInitiativeDetail) => void;
}

const TYPE_LABEL: Record<string, string> = { epic: 'Epic', feature: 'Feature', story: 'Story' };
const TYPE_COLOR: Record<string, string> = {
  epic: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400',
  feature: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400',
  story: 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300',
};

interface WorkItemRowHandle {
  startEdit: () => void;
  startDelete: () => void;
}

const WorkItemRow = forwardRef<WorkItemRowHandle, {
  item: CompletedInitiativeWorkItemRow;
  itemId: string;
  archived: boolean;
  onUpdate: (u: CompletedInitiativeDetail) => void;
  /** Compact mode: show only edit/delete forms (no header row — buttons live in parent). */
  compact?: boolean;
}>(function WorkItemRow({ item, itemId, archived, onUpdate, compact = false }, ref) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setEditTitle(item.title);
    setEditDescription('');
    setError(null);
    setMode('edit');
  };

  const cancelEdit = () => { setMode('view'); setError(null); };

  useImperativeHandle(ref, () => ({
    startEdit,
    startDelete: () => { setError(null); setMode('confirm-delete'); },
  }));

  const handleSave = async () => {
    const updates: { title?: string; description?: string } = {};
    if (editTitle.trim() && editTitle.trim() !== item.title) updates.title = editTitle.trim();
    if (editDescription.trim()) updates.description = editDescription.trim();
    if (Object.keys(updates).length === 0) { setMode('view'); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateAdoWorkItem(itemId, item.adoId, updates, archived);
      onUpdate(updated);
      setMode('view');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.deleteAdoWorkItem(itemId, item.adoId, archived);
      onUpdate(updated);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? 'Delete failed');
      setSaving(false);
      setMode('view');
    }
  };

  // In compact mode (used inside epic/feature headers), only render forms — buttons live in the header row.
  if (compact && mode === 'view') return null;

  return (
    <div className={compact ? '' : 'border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden'}>
      {/* Full row with type badge, title, state, and action buttons (non-compact only) */}
      {!compact && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-surface-800/50">
          <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${TYPE_COLOR[item.adoType] ?? TYPE_COLOR.story}`}>
            {TYPE_LABEL[item.adoType] ?? item.adoType}
          </span>
          <span className="flex-shrink-0 text-[10px] font-mono text-surface-400 dark:text-surface-500 w-14 truncate">{item.localKey}</span>
          <span className="flex-1 min-w-0 text-xs text-surface-800 dark:text-surface-100 truncate">{item.title}</span>
          {item.stateBucket && (
            <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${WORK_ITEM_STATE_BUCKET_COLORS[item.stateBucket]}`}>
              {item.state ?? WORK_ITEM_STATE_BUCKET_LABELS[item.stateBucket]}
            </span>
          )}
          {mode === 'view' && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {item.adoUrl && (
                <a href={item.adoUrl} target="_blank" rel="noreferrer"
                  className="text-[10px] text-brand-600 dark:text-brand-400 hover:underline" title="Open in ADO">↗</a>
              )}
              <button onClick={startEdit} title="Edit"
                className="p-1 rounded text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button onClick={() => { setError(null); setMode('confirm-delete'); }} title="Delete"
                className="p-1 rounded text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Edit form */}
      {mode === 'edit' && (
        <div className="px-3 pb-3 pt-2 border-t border-surface-100 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 space-y-2">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">
              Description <span className="font-normal normal-case">(leave blank to keep existing)</span>
            </label>
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              placeholder="Replaces the current ADO description…"
              rows={3}
              className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 resize-none focus:outline-none focus:border-brand-400"
            />
          </div>
          {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving || !editTitle.trim()}
              className="text-[10px] px-2.5 py-1 rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save to ADO'}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="text-[10px] px-2.5 py-1 rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {mode === 'confirm-delete' && (
        <div className="px-3 pb-3 pt-2 border-t border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 space-y-2">
          <p className="text-xs text-red-700 dark:text-red-400">
            Permanently delete <strong>{item.title}</strong> from ADO?
            {item.adoType === 'feature' && (
              <span className="block mt-0.5 text-[10px] text-red-600 dark:text-red-400 opacity-80">
                Story rows for this feature will also be removed from the tracker. ADO child stories are not automatically deleted — remove those in ADO if needed.
              </span>
            )}
            {item.adoType === 'epic' && (
              <span className="block mt-0.5 text-[10px] text-red-600 dark:text-red-400 opacity-80">
                Only the epic is deleted. Feature and story rows remain in the tracker and in ADO.
              </span>
            )}
          </p>
          {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-1.5">
            <button
              onClick={handleDelete}
              disabled={saving}
              className="text-[10px] px-2.5 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              onClick={() => setMode('view')}
              disabled={saving}
              className="text-[10px] px-2.5 py-1 rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Natural numeric sort for localKeys like "F1", "F2", "F10", "F1.S1", "F1.S10", "F1.S2".
 * Splits on non-digit runs and compares each numeric segment in order so F1.S2 < F1.S10.
 */
function naturalKeyCompare(a: string, b: string): number {
  const seg = (s: string) => s.split(/\D+/).filter(Boolean).map(Number);
  const as = seg(a), bs = seg(b);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const diff = (as[i] ?? 0) - (bs[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Extract the parent feature key from a story localKey: "F1.S3" → "F1". */
function featureKeyOf(storyKey: string): string {
  return storyKey.split('.')[0];
}

interface FeatureGroup {
  feature: CompletedInitiativeWorkItemRow;
  stories: CompletedInitiativeWorkItemRow[];
}

interface EpicGroup {
  epic: CompletedInitiativeWorkItemRow;
  featureGroups: FeatureGroup[];
}

function buildFeatureGroups(
  features: CompletedInitiativeWorkItemRow[],
  allStories: CompletedInitiativeWorkItemRow[]
): FeatureGroup[] {
  const sorted = [...features].sort((a, b) => naturalKeyCompare(a.localKey, b.localKey));
  const storyMap = new Map<string, CompletedInitiativeWorkItemRow[]>();
  for (const story of allStories) {
    const fk = featureKeyOf(story.localKey);
    if (!storyMap.has(fk)) storyMap.set(fk, []);
    storyMap.get(fk)!.push(story);
  }
  for (const stories of storyMap.values()) {
    stories.sort((a, b) => naturalKeyCompare(a.localKey, b.localKey));
  }
  return sorted.map(f => ({ feature: f, stories: storyMap.get(f.localKey) ?? [] }));
}

function buildEpicGroups(items: CompletedInitiativeWorkItemRow[]): {
  epicGroups: EpicGroup[];
  orphanFeatureGroups: FeatureGroup[];
  orphanStories: CompletedInitiativeWorkItemRow[];
} {
  const epics = items.filter(i => i.adoType === 'epic').sort((a, b) => naturalKeyCompare(a.localKey, b.localKey));
  const features = items.filter(i => i.adoType === 'feature');
  const stories = items.filter(i => i.adoType === 'story');

  // Group features by their parent epic key
  const featuresByEpic = new Map<string, CompletedInitiativeWorkItemRow[]>();
  const orphanFeatures: CompletedInitiativeWorkItemRow[] = [];

  for (const f of features) {
    if (f.parentLocalKey) {
      if (!featuresByEpic.has(f.parentLocalKey)) featuresByEpic.set(f.parentLocalKey, []);
      featuresByEpic.get(f.parentLocalKey)!.push(f);
    } else if (epics.length === 1) {
      // Old data without parent_local_key: assign to the only epic
      const key = epics[0].localKey;
      if (!featuresByEpic.has(key)) featuresByEpic.set(key, []);
      featuresByEpic.get(key)!.push(f);
    } else {
      orphanFeatures.push(f);
    }
  }

  // Stories with no matching feature row
  const featureKeys = new Set(features.map(f => f.localKey));
  const orphanStories = stories
    .filter(s => !featureKeys.has(featureKeyOf(s.localKey)))
    .sort((a, b) => naturalKeyCompare(a.localKey, b.localKey));

  const epicGroups: EpicGroup[] = epics.map(e => ({
    epic: e,
    featureGroups: buildFeatureGroups(featuresByEpic.get(e.localKey) ?? [], stories),
  }));

  const orphanFeatureGroups = buildFeatureGroups(orphanFeatures, stories);

  return { epicGroups, orphanFeatureGroups, orphanStories };
}

function ActionButtons({ rowRef }: { rowRef: React.RefObject<WorkItemRowHandle | null> }) {
  return (
    <>
      <button onClick={() => rowRef.current?.startEdit()} title="Edit"
        className="p-1 rounded text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
      <button onClick={() => rowRef.current?.startDelete()} title="Delete"
        className="p-1 rounded text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </>
  );
}

function FeatureSection({
  group, itemId, archived, onUpdate,
}: {
  group: FeatureGroup;
  itemId: string;
  archived: boolean;
  onUpdate: (u: CompletedInitiativeDetail) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<WorkItemRowHandle>(null);
  const { feature, stories } = group;

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      {/* Feature header — always visible, includes edit/delete/ADO buttons inline */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-50 dark:bg-surface-800/60">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <svg
            className={`w-3 h-3 flex-shrink-0 text-surface-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${TYPE_COLOR.feature}`}>
            Feature
          </span>
          <span className="flex-shrink-0 text-[10px] font-mono text-surface-400 dark:text-surface-500 w-8">{feature.localKey}</span>
          <span className="flex-1 min-w-0 text-xs font-medium text-surface-800 dark:text-surface-100 truncate">{feature.title}</span>
          <span className="flex-shrink-0 text-[10px] text-surface-400 dark:text-surface-500">
            {stories.length} stor{stories.length !== 1 ? 'ies' : 'y'}
          </span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          {feature.stateBucket && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${WORK_ITEM_STATE_BUCKET_COLORS[feature.stateBucket]}`}>
              {feature.state ?? WORK_ITEM_STATE_BUCKET_LABELS[feature.stateBucket]}
            </span>
          )}
          {feature.adoUrl && (
            <a href={feature.adoUrl} target="_blank" rel="noreferrer"
              className="text-[10px] text-brand-600 dark:text-brand-400 hover:underline" title="Open in ADO">↗</a>
          )}
          <ActionButtons rowRef={rowRef} />
        </div>
      </div>

      {/* Compact form row (edit/confirm-delete) — renders only when active */}
      <WorkItemRow ref={rowRef} item={feature} itemId={itemId} archived={archived} onUpdate={onUpdate} compact />

      {/* Child stories — only when expanded */}
      {expanded && stories.length > 0 && (
        <div className="border-t border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700/60">
          {stories.map(story => (
            <div key={story.adoId} className="pl-5">
              <WorkItemRow item={story} itemId={itemId} archived={archived} onUpdate={onUpdate} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EpicSection({
  group, itemId, archived, onUpdate,
}: {
  group: EpicGroup;
  itemId: string;
  archived: boolean;
  onUpdate: (u: CompletedInitiativeDetail) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<WorkItemRowHandle>(null);
  const { epic, featureGroups } = group;
  const storyCount = featureGroups.reduce((sum, fg) => sum + fg.stories.length, 0);

  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-800/40 overflow-hidden">
      {/* Epic header — always visible, includes edit/delete/ADO buttons inline */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-violet-50 dark:bg-violet-900/20">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <svg
            className={`w-3 h-3 flex-shrink-0 text-violet-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${TYPE_COLOR.epic}`}>
            Epic
          </span>
          <span className="flex-1 min-w-0 text-xs font-semibold text-surface-800 dark:text-surface-100 truncate">{epic.title}</span>
          <span className="flex-shrink-0 text-[10px] text-surface-400 dark:text-surface-500">
            {featureGroups.length} feature{featureGroups.length !== 1 ? 's' : ''} · {storyCount} stor{storyCount !== 1 ? 'ies' : 'y'}
          </span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          {epic.stateBucket && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${WORK_ITEM_STATE_BUCKET_COLORS[epic.stateBucket]}`}>
              {epic.state ?? WORK_ITEM_STATE_BUCKET_LABELS[epic.stateBucket]}
            </span>
          )}
          {epic.adoUrl && (
            <a href={epic.adoUrl} target="_blank" rel="noreferrer"
              className="text-[10px] text-brand-600 dark:text-brand-400 hover:underline" title="Open in ADO">↗</a>
          )}
          <ActionButtons rowRef={rowRef} />
        </div>
      </div>

      {/* Compact form row (edit/confirm-delete) — renders only when active */}
      <WorkItemRow ref={rowRef} item={epic} itemId={itemId} archived={archived} onUpdate={onUpdate} compact />

      {/* Nested features — only when expanded */}
      {expanded && featureGroups.length > 0 && (
        <div className="border-t border-violet-100 dark:border-violet-800/30 divide-y divide-violet-50 dark:divide-violet-800/20">
          {featureGroups.map(fg => (
            <div key={fg.feature.adoId} className="pl-4">
              <FeatureSection group={fg} itemId={itemId} archived={archived} onUpdate={onUpdate} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkItemManagePanel({ items, itemId, archived, onUpdate }: Props) {
  const { epicGroups, orphanFeatureGroups, orphanStories } = buildEpicGroups(items);

  if (items.length === 0) {
    return <p className="text-sm text-surface-400 italic">No work items tracked for this initiative.</p>;
  }

  return (
    <div className="space-y-5">
      {epicGroups.length > 0 && (
        <div className="space-y-2">
          {epicGroups.map(group => (
            <EpicSection key={group.epic.adoId} group={group} itemId={itemId} archived={archived} onUpdate={onUpdate} />
          ))}
        </div>
      )}

      {orphanFeatureGroups.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">
            Unassigned Features ({orphanFeatureGroups.length})
          </h4>
          <div className="space-y-1.5">
            {orphanFeatureGroups.map(group => (
              <FeatureSection key={group.feature.adoId} group={group} itemId={itemId} archived={archived} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      )}

      {orphanStories.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-2">
            Unassigned Stories ({orphanStories.length})
          </h4>
          <div className="space-y-1.5">
            {orphanStories.map(item => (
              <WorkItemRow key={item.adoId} item={item} itemId={itemId} archived={archived} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
