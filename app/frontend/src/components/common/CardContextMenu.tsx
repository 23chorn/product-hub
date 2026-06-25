import { createPortal } from 'react-dom';

interface CardContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface CardContextMenuProps {
  x: number;
  y: number;
  items: CardContextMenuItem[];
  onClose: () => void;
}

/** Small right-click popover menu, positioned at the click coordinates. Same
 *  fixed-overlay + portal shape as the admin user switcher dropdown in App.tsx. */
export function CardContextMenu({ x, y, items, onClose }: CardContextMenuProps) {
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="fixed z-[9999] min-w-[170px] bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg shadow-2xl overflow-hidden py-1"
        style={{ top: y, left: x }}
      >
        {items.map(item => (
          <button
            key={item.label}
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
              item.danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
