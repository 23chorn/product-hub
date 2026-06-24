import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageHeaderStore } from '../../stores/pageHeaderStore';

/** Portals page-specific controls into the shared PageHeader's actions slot. */
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const actionsNode = usePageHeaderStore(s => s.actionsNode);
  if (!actionsNode) return null;
  return createPortal(children, actionsNode);
}
