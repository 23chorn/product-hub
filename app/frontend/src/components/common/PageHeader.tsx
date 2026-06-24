import { usePageHeaderStore } from '../../stores/pageHeaderStore';

/** Sub-header shown above every page's content, at a fixed height regardless
 * of page: a title slot on the left (page description, or — for an open
 * initiative — the pipeline's back button/name/status) and an actions slot
 * on the right, both filled by the active page via PageHeaderTitle /
 * PageHeaderActions portals. */
export function PageHeader() {
  const setTitleNode = usePageHeaderStore(s => s.setTitleNode);
  const setActionsNode = usePageHeaderStore(s => s.setActionsNode);
  return (
    <div className="flex-shrink-0 h-14 flex items-center gap-4 bg-white/90 dark:bg-surface-900/80 backdrop-blur-sm border-b border-surface-200 dark:border-surface-700 px-6">
      <div ref={setTitleNode} className="flex-1 min-w-0 flex items-center gap-3 overflow-hidden" />
      <div ref={setActionsNode} className="flex items-center gap-2 flex-nowrap flex-shrink-0 max-w-[70%] overflow-x-auto" />
    </div>
  );
}
