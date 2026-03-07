import { create } from 'zustand';
import { ToastType } from '../components/Toast';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (message: string, type: ToastType) => void;
  removeToast: (id: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));
  },

  removeToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },

  success: (message: string) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type: 'success' }],
    }));
  },

  error: (message: string) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type: 'error' }],
    }));
  },

  info: (message: string) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type: 'info' }],
    }));
  },

  warning: (message: string) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type: 'warning' }],
    }));
  },
}));

export function useToast() {
  const { success, error, info, warning } = useToastStore();
  return { success, error, info, warning };
}
