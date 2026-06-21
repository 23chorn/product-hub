import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyPassword, hasAnyUsers, getUserById } from '../data/users';
import { signToken, setAuthCookie, clearAuthCookie, authMiddleware, JWT_SECRET, COOKIE_NAME } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import Logger from '../utils/logger';

const logger = new Logger('AUTH-ROUTES');
const router = Router();

/** POST /api/auth/login */
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    logger.warn(`Login rejected — missing credentials from ${req.ip}`);
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const userRow = await verifyPassword(username.trim(), password);
  if (!userRow) {
    logger.warn(`Login failed for username "${username.trim()}" from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken(userRow.id);
  setAuthCookie(res, token);
  logger.info(`Login succeeded for user ${userRow.id} (${userRow.username}) from ${req.ip}`);
  res.json({ ok: true, userId: userRow.id });
});

/** POST /api/auth/logout */
router.post('/logout', (req: Request, res: Response) => {
  // Logout isn't gated by authMiddleware (an expired/invalid cookie should still log out
  // cleanly), so decode best-effort here just to attribute the log line.
  let who = 'unknown';
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const { sub } = jwt.verify(token, JWT_SECRET) as unknown as { sub: number };
      const user = getUserById(sub);
      if (user) who = `${user.id} (${user.username})`;
    } catch { /* expired/invalid token — log out anyway */ }
  }
  clearAuthCookie(res);
  logger.info(`Logout for user ${who} from ${req.ip}`);
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
