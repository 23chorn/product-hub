import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageHeaderStore } from '../../stores/pageHeaderStore';

/** Portals page-specific title content into the shared PageHeader's title slot. */
export function PageHeaderTitle({ children }: { children: ReactNode }) {
  const titleNode = usePageHeaderStore(s => s.titleNode);
  if (!titleNode) return null;
  return createPortal(children, titleNode);
}
