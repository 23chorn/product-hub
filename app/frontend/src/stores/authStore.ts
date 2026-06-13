import { create } from 'zustand';

export interface CurrentUser {
  id: number;
  username: string;
  email: string | null;
  name: string;
  is_admin: boolean;
  slack_user_id: string | null;
  roles: string[];
}

interface AuthState {
  user: CurrentUser | null;
  realUser: CurrentUser | null;   // the actually-authenticated user (unchanged during impersonation)
  noAuth: boolean;                // true when system has no users (bypass mode)
  loading: boolean;
  impersonating: boolean;
  setUser: (user: CurrentUser | null) => void;
  setNoAuth: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  logout: () => void;
  impersonate: (target: CurrentUser) => void;
  stopImpersonating: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  realUser: null,
  noAuth: false,
  loading: true,
  impersonating: false,
  setUser: (user) => set({ user, realUser: user, loading: false }),
  setNoAuth: (noAuth) => set({ noAuth, loading: false }),
  setLoading: (loading) => set({ loading }),
  logout: () => set({ user: null, realUser: null, noAuth: false, impersonating: false }),
  impersonate: (target) => set({ user: target, impersonating: true }),
  stopImpersonating: () => set({ user: get().realUser, impersonating: false }),
}));

/** Returns true if the current user can approve a checkpoint with the given required_role. */
export function canApprove(user: CurrentUser | null, noAuth: boolean, requiredRole: string | null): boolean {
  if (noAuth) return true;
  if (!user) return false;
  if (user.is_admin) return true;
  if (!requiredRole) return true;
  return user.roles.includes(requiredRole);
}

export const ROLE_LABELS: Record<string, string> = {
  product: 'Product',
  tech_lead: 'Tech Lead',
  design: 'Design',
};
