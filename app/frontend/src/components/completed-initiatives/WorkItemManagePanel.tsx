import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import type { CompletedInitiativeDetail, CompletedInitiativeWorkItemRow, TestCase } from '@pap/shared';
import { api } from '../../services/api';
import { WORK_ITEM_STATE_BUCKET_COLORS, WORK_ITEM_STATE_BUCKET_LABELS } from '../../utils/work-item-state-bucket';

interface Props {
  items: CompletedInitiativeWorkItemRow[];
  itemId: string;
  archived: boolean;
  onUpdate: (updated: CompletedInitiativeDetail) => void;
  testCases?: TestCase[] | null;
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

const TC_TYPES = ['happy_path', 'negative', 'edge', 'boundary', 'security', 'performance'] as const;
const TC_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

const TC_TYPE_COLOR: Record<string, string> = {
  happy_path:  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  negative:    'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  edge:        'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  boundary:    'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  security:    'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  performance: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400',
};
const TC_PRIORITY_COLOR: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  high:     'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  medium:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  low:      'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400',
};

interface TcGroup {
  key: string;
  label: string;
  cases: TestCase[];
}

function buildTcGroups(cases: TestCase[]): TcGroup[] {
  const epicCases: TestCase[] = [];
  const featureMap = new Map<string, TestCase[]>();
  const ungrouped: TestCase[] = [];

  for (const tc of cases) {
    if (!tc.id || tc.id.startsWith('TC-E-') || tc.id.startsWith('TC-M-')) {
      epicCases.push(tc);
      continue;
    }
    let fk: string | null = null;
    if (tc.story_ref && typeof tc.story_ref === 'string') {
      const m = tc.story_ref.match(/^(F\d+)/i);
      if (m) fk = m[1].toUpperCase();
    }
    if (!fk && (tc as any).features?.length) {
      const m = String((tc as any).features[0]).match(/^(F\d+)/i);
      if (m) fk = m[1].toUpperCase();
    }
    if (fk) {
      if (!featureMap.has(fk)) featureMap.set(fk, []);
      featureMap.get(fk)!.push(tc);
    } else {
      ungrouped.push(tc);
    }
  }

  const groups: TcGroup[] = [];
  if (epicCases.length > 0) {
    groups.push({ key: '__epic__', label: 'Epic QA Tests', cases: epicCases });
  }
  const sortedKeys = [...featureMap.keys()].sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return numA - numB;
  });
  for (const fk of sortedKeys) {
    groups.push({ key: fk, label: `Feature ${fk}`, cases: featureMap.get(fk)! });
  }
  if (ungrouped.length > 0) {
    groups.push({ key: '__other__', label: 'Other', cases: ungrouped });
  }
  return groups;
}

function TcGroupSection({
  group, onDelete, deleteId, setDeleteId, saving, onClearError,
}: {
  group: TcGroup;
  onDelete: (id: string) => void;
  deleteId: string | null;
  setDeleteId: (id: string | null) => void;
  saving: boolean;
  onClearError: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-50 dark:bg-surface-800/60 hover:bg-surface-100 dark:hover:bg-surface-700/50 transition-colors"
      >
        <svg
          className={`w-3 h-3 text-surface-400 flex-shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="text-[11px] font-semibold text-surface-700 dark:text-surface-200 flex-1 text-left">
          {group.label}
        </span>
        <span className="text-[10px] text-surface-400 dark:text-surface-500 flex-shrink-0">
          {group.cases.length} {group.cases.length === 1 ? 'case' : 'cases'}
        </span>
      </button>

      {!collapsed && (
        <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
          {group.cases.map(tc => (
            <div key={tc.id || tc.title} className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-surface-800/50">
              {tc.type && (
                <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded ${TC_TYPE_COLOR[tc.type] ?? TC_TYPE_COLOR.edge}`}>
                  {tc.type.replace(/_/g, ' ')}
                </span>
              )}
              {tc.priority && (
                <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${TC_PRIORITY_COLOR[tc.priority] ?? TC_PRIORITY_COLOR.low}`}>
                  {tc.priority}
                </span>
              )}
              {tc.id && (
                <span className="flex-shrink-0 text-[10px] font-mono text-surface-400 dark:text-surface-500">{tc.id}</span>
              )}
              <span className="flex-1 min-w-0 text-xs text-surface-800 dark:text-surface-100 truncate">{tc.title}</span>
              {tc.id && (
                deleteId === tc.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onDelete(tc.id)}
                      disabled={saving}
                      className="text-[10px] px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
                    >
                      {saving ? '…' : 'Delete'}
                    </button>
                    <button onClick={() => setDeleteId(null)} disabled={saving}
                      className="text-[10px] px-2 py-0.5 rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setDeleteId(tc.id); onClearError(); }}
                    title="Delete"
                    className="flex-shrink-0 p-1 rounded text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TestCasesSection({
  initialCases, itemId, archived, onUpdate,
}: {
  initialCases: TestCase[];
  itemId: string;
  archived: boolean;
  onUpdate: (updated: CompletedInitiativeDetail) => void;
}) {
  const [cases, setCases] = useState<TestCase[]>(initialCases);
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addType, setAddType] = useState<string>('happy_path');
  const [addPriority, setAddPriority] = useState<string>('medium');
  const [addDesc, setAddDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = buildTcGroups(cases);

  const handleAdd = async () => {
    if (!addTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.addTestCase(itemId, { title: addTitle.trim(), type: addType, priority: addPriority, description: addDesc.trim() || undefined }, archived);
      onUpdate(updated);
      const newCase: TestCase = { id: '', title: addTitle.trim(), type: addType, priority: addPriority, ...(addDesc.trim() ? { description: addDesc.trim() } : {}) };
      setCases(prev => [...prev, newCase]);
      setAddTitle(''); setAddDesc(''); setAddType('happy_path'); setAddPriority('medium');
      setShowAdd(false);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? 'Failed to add test case');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tcId: string) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.deleteTestCase(itemId, tcId, archived);
      onUpdate(updated);
      setCases(prev => prev.filter(tc => tc.id !== tcId));
      setDeleteId(null);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err.message ?? 'Failed to delete test case');
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">
          Test Cases ({cases.length})
        </h3>
        <button
          onClick={() => { setShowAdd(v => !v); setError(null); }}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-dashed border-surface-300 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add test case
        </button>
      </div>

      {showAdd && (
        <div className="mb-3 rounded-lg border border-brand-200 dark:border-brand-800/50 bg-brand-50/50 dark:bg-brand-900/10 p-3 space-y-2">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Title *</label>
            <input
              type="text"
              value={addTitle}
              onChange={e => setAddTitle(e.target.value)}
              placeholder="What is being verified…"
              className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:border-brand-400"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Type</label>
              <select
                value={addType}
                onChange={e => setAddType(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 focus:outline-none focus:border-brand-400"
              >
                {TC_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Priority</label>
              <select
                value={addPriority}
                onChange={e => setAddPriority(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-300 focus:outline-none focus:border-brand-400"
              >
                {TC_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">Description <span className="font-normal normal-case">(optional)</span></label>
            <textarea
              value={addDesc}
              onChange={e => setAddDesc(e.target.value)}
              placeholder="Why this scenario matters…"
              rows={2}
              className="w-full text-xs px-2 py-1.5 rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 resize-none focus:outline-none focus:border-brand-400"
            />
          </div>
          {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-1.5">
            <button
              onClick={handleAdd}
              disabled={saving || !addTitle.trim()}
              className="text-[10px] px-2.5 py-1 rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError(null); }}
              disabled={saving}
              className="text-[10px] px-2.5 py-1 rounded border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {cases.length === 0 && !showAdd && (
        <p className="text-xs text-surface-400 italic">No test cases yet.</p>
      )}

      <div className="space-y-2">
        {groups.map(group => (
          <TcGroupSection
            key={group.key}
            group={group}
            onDelete={handleDelete}
            deleteId={deleteId}
            setDeleteId={setDeleteId}
            saving={saving}
            onClearError={() => setError(null)}
          />
        ))}
      </div>

      {error && !showAdd && <p className="mt-2 text-[10px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function WorkItemManagePanel({ items, itemId, archived, onUpdate, testCases }: Props) {
  const { epicGroups, orphanFeatureGroups, orphanStories } = buildEpicGroups(items);
  const hasWorkItems = items.length > 0;

  return (
    <div className="space-y-8">
      {hasWorkItems ? (
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
      ) : (
        <p className="text-sm text-surface-400 italic">No work items tracked for this initiative.</p>
      )}

      {testCases != null && (
        <div className="border-t border-surface-200 dark:border-surface-700 pt-6">
          <TestCasesSection
            initialCases={testCases}
            itemId={itemId}
            archived={archived}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  );
}
