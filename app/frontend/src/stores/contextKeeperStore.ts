import { create } from 'zustand';
import type { StatusChange, ContextChangeProposal } from '@pap/shared';

interface ContextKeeperState {
  pendingCount: number;
  lastChecked: number | null;
  changes: StatusChange[];
  proposals: ContextChangeProposal[];
  isChecking: boolean;
  isReviewing: boolean;
  sessionId: string | null;

  setPendingCount: (n: number) => void;
  setLastChecked: (ts: number | null) => void;
  setChanges: (changes: StatusChange[]) => void;
  setProposals: (proposals: ContextChangeProposal[]) => void;
  setIsChecking: (val: boolean) => void;
  setIsReviewing: (val: boolean) => void;
  setSessionId: (id: string | null) => void;
  updateProposalStatus: (id: number, status: 'confirmed' | 'dismissed') => void;
}

export const useContextKeeperStore = create<ContextKeeperState>((set) => ({
  pendingCount: 0,
  lastChecked: null,
  changes: [],
  proposals: [],
  isChecking: false,
  isReviewing: false,
  sessionId: null,

  setPendingCount: (n) => set({ pendingCount: n }),
  setLastChecked: (ts) => set({ lastChecked: ts }),
  setChanges: (changes) => set({ changes }),
  setProposals: (proposals) =>
    set({
      proposals,
      pendingCount: proposals.filter((p) => p.status === 'pending').length,
    }),
  setIsChecking: (val) => set({ isChecking: val }),
  setIsReviewing: (val) => set({ isReviewing: val }),
  setSessionId: (id) => set({ sessionId: id }),
  updateProposalStatus: (id, status) =>
    set((state) => {
      const proposals = state.proposals.map((p) =>
        p.id === id ? { ...p, status } : p
      );
      return {
        proposals,
        pendingCount: proposals.filter((p) => p.status === 'pending').length,
      };
    }),
}));
