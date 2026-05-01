import { create } from 'zustand';
import type { AirtableItem, AppMode } from '@pap/shared';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type { AppMode };

interface AgentInfo {
  name: string;
  icon: string;
  title: string;
}

interface SessionState {
  // App mode (PRD, Backlog, or Analyst)
  mode: AppMode;
  setMode: (mode: AppMode) => void;

  // Selected roadmap item (from Airtable)
  selectedItem: AirtableItem | null;
  setSelectedItem: (item: AirtableItem | null) => void;

  // Session
  sessionId: string | null;
  setSessionId: (id: string | null) => void;

  // Agent info
  agentInfo: AgentInfo | null;
  setAgentInfo: (info: AgentInfo | null) => void;

  // Active workflow
  activeWorkflow: string | null;
  setActiveWorkflow: (code: string | null) => void;

  // Chat messages
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;

  // PRD content (for preview)
  prdContent: string;
  setPRDContent: (content: string) => void;

  // Backlog content (JSON string for preview)
  backlogContent: string;
  setBacklogContent: (content: string) => void;

  // Analyst content (markdown for preview)
  analystContent: string;
  setAnalystContent: (content: string) => void;

  // UI state
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;

  // Reset everything
  reset: () => void;

  // Clear session (keeps mode and selected item)
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  // Initial state
  mode: 'analyst',
  selectedItem: null,
  sessionId: null,
  agentInfo: null,
  activeWorkflow: null,
  messages: [],
  prdContent: '',
  backlogContent: '',
  analystContent: '',
  isStreaming: false,

  // Actions
  setMode: (mode) => set({ mode }),

  setSelectedItem: (item) => set({ selectedItem: item }),

  setSessionId: (id) => set({ sessionId: id }),

  setAgentInfo: (info) => set({ agentInfo: info }),

  setActiveWorkflow: (code) => set({ activeWorkflow: code }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  updateLastMessage: (content) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const newMessages = [...state.messages];
      newMessages[newMessages.length - 1] = {
        ...newMessages[newMessages.length - 1],
        content,
      };
      return { messages: newMessages };
    }),

  clearMessages: () => set({ messages: [] }),

  setPRDContent: (content) => set({ prdContent: content }),

  setBacklogContent: (content) => set({ backlogContent: content }),

  setAnalystContent: (content) => set({ analystContent: content }),

  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  reset: () =>
    set({
      mode: 'analyst',
      selectedItem: null,
      sessionId: null,
      agentInfo: null,
      activeWorkflow: null,
      messages: [],
      prdContent: '',
      backlogContent: '',
      analystContent: '',
      isStreaming: false,
    }),

  clearSession: () =>
    set({
      sessionId: null,
      agentInfo: null,
      activeWorkflow: null,
      messages: [],
      prdContent: '',
      backlogContent: '',
      analystContent: '',
      isStreaming: false,
    }),
}));
