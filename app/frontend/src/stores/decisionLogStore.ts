import { create } from 'zustand';
import type { ChatMessage, MonthEntry } from '@pap/shared';

interface DecisionLogState {
  isOpen: boolean;
  sessionId: string | null;
  monthId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  currentMonthLog: string;
  availableMonths: MonthEntry[];
  selectedMonth: string | null; // YYYY-MM for browsing past months

  openDecisionLog: () => void;
  closeDecisionLog: () => void;
  setSession: (sessionId: string, monthId: string, messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setIsStreaming: (val: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setCurrentMonthLog: (content: string) => void;
  setAvailableMonths: (months: MonthEntry[]) => void;
  setSelectedMonth: (month: string | null) => void;
}

export const useDecisionLogStore = create<DecisionLogState>((set) => ({
  isOpen: false,
  sessionId: null,
  monthId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  currentMonthLog: '',
  availableMonths: [],
  selectedMonth: null,

  openDecisionLog: () => set({ isOpen: true }),
  closeDecisionLog: () => set({ isOpen: false }),

  setSession: (sessionId, monthId, messages) =>
    set({ sessionId, monthId, messages }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateLastMessage: (content) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
      return { messages: msgs };
    }),

  setIsStreaming: (val) => set({ isStreaming: val }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  setCurrentMonthLog: (content) => set({ currentMonthLog: content }),
  setAvailableMonths: (months) => set({ availableMonths: months }),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
}));
