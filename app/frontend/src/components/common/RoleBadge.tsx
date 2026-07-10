import type { ReactNode } from 'react';

export type RoleBadgeVariant = 'assigned' | 'required';
export type RoleBadgeShape = 'chip' | 'tag';

// 'assigned' = a role a user holds; 'required' = a role needed to approve something.
// Keeping these on two distinct colors lets a reader tell "who has this role" apart
// from "who is this stage waiting on" at a glance, wherever either appears.
const VARIANT_COLOR: Record<RoleBadgeVariant, string> = {
  assigned: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400',
  required: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400',
};

// 'chip' = compact inline label (settings lists, checkpoint rows). 'tag' = matches the
// uppercase/tracking-wide badge-strip convention used by StatusBadge and its siblings.
const SHAPE_CLASS: Record<RoleBadgeShape, string> = {
  chip: 'text-[10px] font-medium px-1.5 py-0.5 rounded',
  tag: 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
};

/**
 * Shared pill for a role name. Single source of truth for role-chip color/shape so
 * Settings, the header user-switcher, initiative cards, and checkpoint rows don't each
 * hand-roll their own className.
 */
export function RoleBadge({
  children,
  variant = 'assigned',
  shape = 'chip',
  onRemove,
  title,
  className = '',
}: {
  children: ReactNode;
  variant?: RoleBadgeVariant;
  shape?: RoleBadgeShape;
  onRemove?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 flex-shrink-0 ${SHAPE_CLASS[shape]} ${VARIANT_COLOR[variant]} ${className}`}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="leading-none hover:opacity-70"
          title="Remove role"
        >
          ×
        </button>
      )}
    </span>
  );
}
