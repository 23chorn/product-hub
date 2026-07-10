import type { ReactNode } from 'react';

export type InfoBadgeVariant = 'productArea' | 'theme';
export type InfoBadgeShape = 'chip' | 'tag';

// One color per concept so a product-area badge never gets mistaken for a theme badge,
// no matter which screen it's rendered on.
const VARIANT_COLOR: Record<InfoBadgeVariant, string> = {
  productArea: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  theme: 'bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-400',
};

// 'tag' = the uppercase/tracking-wide badge-strip convention used everywhere today
// (StatusBadge, RoleBadge's card usage). 'chip' = compact inline label, kept for any
// future dense-list context that shouldn't shout in all-caps.
const SHAPE_CLASS: Record<InfoBadgeShape, string> = {
  chip: 'text-[10px] font-medium px-1.5 py-0.5 rounded',
  tag: 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
};

/**
 * Shared pill for a product-area or strategic-theme label. Single source of truth for
 * their color/shape so the Home card, the initiative header, and the completed-initiative
 * header don't each hand-roll their own className.
 */
export function InfoBadge({
  children,
  variant,
  shape = 'tag',
  className = '',
}: {
  children: ReactNode;
  variant: InfoBadgeVariant;
  shape?: InfoBadgeShape;
  className?: string;
}) {
  return (
    <span className={`flex-shrink-0 ${SHAPE_CLASS[shape]} ${VARIANT_COLOR[variant]} ${className}`}>
      {children}
    </span>
  );
}
