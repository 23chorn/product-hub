import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { hasAnyUsers, getUserById } from '../data/users';
import type { User } from '../data/users';

const JWT_SECRET = process.env.JWT_SECRET || 'pap-local-dev-secret-change-in-production';
const COOKIE_NAME = 'pap_token';

export interface AuthRequest extends Request {
  user?: User;
  isAuthenticated?: boolean;
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

/**
 * Auth middleware. Attaches req.user if a valid JWT cookie is present.
 *
 * Bypass rule: if no users exist in the DB, auth is not required — the system
 * operates in single-user mode with admin-equivalent access for backward compat.
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  // No users in system → bypass auth (fresh install / no-auth mode)
  if (!hasAnyUsers()) {
    req.isAuthenticated = true;
    req.user = undefined; // admin-level access without a real user
    return next();
  }

  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number };
    const user = getUserById(payload.sub);
    if (!user) {
      clearAuthCookie(res);
      res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' });
      return;
    }
    req.user = user;
    req.isAuthenticated = true;
    next();
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ error: 'Session expired', code: 'UNAUTHENTICATED' });
  }
}

/**
 * Require admin access. Must be used after authMiddleware.
 * In no-auth mode (no users), passes through.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!hasAnyUsers()) return next();
  if (!req.user?.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * Check whether the current user can approve a checkpoint with the given required_role.
 * Returns true if: no-auth mode, admin, no role required, or user has the required role.
 */
export function canApproveCheckpoint(user: User | undefined, requiredRole: string | null): boolean {
  if (!hasAnyUsers()) return true;       // no-auth mode
  if (!user) return false;
  if (user.is_admin) return true;        // admin can approve anything
  if (!requiredRole) return true;        // no role required
  return user.roles.includes(requiredRole);
}

export { JWT_SECRET, COOKIE_NAME };
