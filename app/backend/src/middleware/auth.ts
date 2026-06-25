import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { hasAnyUsers, getUserById } from '../data/users';
import type { User } from '../data/users';
import Logger from '../utils/logger';

const logger = new Logger('AUTH');
const JWT_SECRET = process.env.JWT_SECRET || 'pap-local-dev-secret-change-in-production';
const COOKIE_NAME = 'pap_token';
// Browsers drop `secure` cookies on plain HTTP, so this can't just follow NODE_ENV —
// an internal-network prod deployment without TLS still needs the cookie to be sent.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

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
    secure: COOKIE_SECURE,
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
      logger.warn(`Rejected request from ${req.ip} — token valid but user ${payload.sub} no longer exists (${req.method} ${req.originalUrl})`);
      clearAuthCookie(res);
      res.status(401).json({ error: 'User not found', code: 'UNAUTHENTICATED' });
      return;
    }
    req.user = user;
    req.isAuthenticated = true;
    next();
  } catch (err: any) {
    logger.warn(`Rejected request from ${req.ip} — ${err?.name ?? 'invalid token'} (${req.method} ${req.originalUrl})`);
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
 * Require admin access or a specific named role. Must be used after authMiddleware.
 * In no-auth mode (no users), passes through.
 */
export function requireRole(roleName: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!hasAnyUsers()) return next();
    if (req.user?.is_admin || req.user?.roles.includes(roleName)) return next();
    res.status(403).json({ error: `${roleName} access required` });
  };
}

/**
 * view_only is a hard-deny marker role: no approvals/rejections, no Studio edits,
 * no Airtable sync, no new initiatives — regardless of any other role a user holds.
 */
export function isViewOnly(user: User | undefined): boolean {
  if (!user) return false;
  return !user.is_admin && user.roles.includes('view_only');
}

/**
 * Check whether the current user can approve a checkpoint with the given required roles.
 * Returns true if: no-auth mode, admin, no roles required, or user has any of the required roles.
 */
export function canApproveCheckpoint(user: User | undefined, requiredRoles: string[]): boolean {
  if (!hasAnyUsers()) return true;
  if (!user) return false;
  if (user.is_admin) return true;
  if (isViewOnly(user)) return false;
  if (requiredRoles.length === 0) return true;
  return requiredRoles.some(r => user.roles.includes(r));
}

/** Only Product or Admin may launch a new workflow — other roles can review/approve but not kick off the pipeline. */
export function canLaunchWorkflow(user: User | undefined): boolean {
  if (!hasAnyUsers()) return true;
  if (!user) return false;
  if (user.is_admin) return true;
  return user.roles.includes('product');
}

export { JWT_SECRET, COOKIE_NAME };
