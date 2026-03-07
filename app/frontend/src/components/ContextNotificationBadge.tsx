import { useContextKeeperStore } from '../stores/contextKeeperStore';

interface Props {
  onClick: () => void;
  isActive: boolean;
}

export function ContextNotificationBadge({ onClick, isActive }: Props) {
  const { pendingCount, changes } = useContextKeeperStore();
  const badgeCount = pendingCount > 0 ? pendingCount : changes.length;

  return (
    <button
      onClick={onClick}
      title={
        pendingCount > 0
          ? `${pendingCount} pending context update${pendingCount !== 1 ? 's' : ''}`
          : changes.length > 0
          ? `${changes.length} status change${changes.length !== 1 ? 's' : ''} detected`
          : 'Context health'
      }
      className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors shadow-sm ${
        isActive
          ? 'bg-blue-600 text-white border-blue-600'
          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
      }`}
    >
      <span>🔄</span>
      <span>Context</span>
      {badgeCount > 0 && (
        <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold bg-amber-500 text-white">
          {badgeCount}
        </span>
      )}
    </button>
  );
}
