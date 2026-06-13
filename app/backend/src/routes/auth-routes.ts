import { Router, Request, Response } from 'express';
import { verifyPassword, hasAnyUsers } from '../data/users';
import { signToken, setAuthCookie, clearAuthCookie, authMiddleware } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

/** POST /api/auth/login */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const userRow = await verifyPassword(username.trim(), password);
  if (!userRow) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken(userRow.id);
  setAuthCookie(res, token);
  res.json({ ok: true, userId: userRow.id });
});

/** POST /api/auth/logout */
router.post('/logout', (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/** GET /api/auth/me — returns current user or {noAuth: true} */
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  if (!hasAnyUsers()) {
    return res.json({ noAuth: true, user: null });
  }
  res.json({ user: req.user ?? null });
});

export default router;
