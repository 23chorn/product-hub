import { Router, Response } from 'express';
import {
  listUsers, createUser, updateUser, deleteUser,
  getAvailableRoles, getStageRoles, setStageRole, addStageRole, removeStageRole,
} from '../data/users';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import db from '../data/database';

const router = Router();
router.use(authMiddleware, requireAdmin);

/** GET /api/users — list all users */
router.get('/', (_req: AuthRequest, res: Response) => {
  res.json({ users: listUsers() });
});

/** POST /api/users — create a user */
router.post('/', async (req: AuthRequest, res: Response) => {
  const { username, email, name, password, is_admin, slack_user_id, roles } = req.body as {
    username?: string; email?: string; name?: string; password?: string;
    is_admin?: boolean; slack_user_id?: string; roles?: string[];
  };
  if (!username?.trim() || !name?.trim() || !password || password.length < 6) {
    return res.status(400).json({ error: 'username, name, and password (min 6 chars) are required' });
  }
  try {
    const user = await createUser({ username: username.trim(), email: email?.trim() || null, name: name.trim(), password, is_admin, slack_user_id, roles });
    res.status(201).json({ user });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A user with that username already exists' });
    }
    throw err;
  }
});

/** GET /api/users/roles — list available roles */
router.get('/roles', (_req: AuthRequest, res: Response) => {
  res.json({ roles: getAvailableRoles() });
});

/** GET /api/users/stage-roles — stage → role mapping */
router.get('/stage-roles', (_req: AuthRequest, res: Response) => {
  res.json({ stageRoles: getStageRoles() });
});

/** PUT /api/users/stage-roles — add a role to a stage (alias for POST, kept for backward compat) */
router.put('/stage-roles', (req: AuthRequest, res: Response) => {
  const { stage, role_name } = req.body as { stage?: string; role_name?: string };
  if (!stage || !role_name) return res.status(400).json({ error: 'stage and role_name are required' });
  addStageRole(stage, role_name);
  res.json({ ok: true });
});

/** POST /api/users/stage-roles — add a role to a stage */
router.post('/stage-roles', (req: AuthRequest, res: Response) => {
  const { stage, role_name } = req.body as { stage?: string; role_name?: string };
  if (!stage || !role_name) return res.status(400).json({ error: 'stage and role_name are required' });
  addStageRole(stage, role_name);
  res.json({ ok: true });
});

/** DELETE /api/users/stage-roles — remove a role from a stage */
router.delete('/stage-roles', (req: AuthRequest, res: Response) => {
  const { stage, role_name } = req.body as { stage?: string; role_name?: string };
  if (!stage || !role_name) return res.status(400).json({ error: 'stage and role_name are required' });
  removeStageRole(stage, role_name);
  res.json({ ok: true });
});

/** PUT /api/users/:id — update a user */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });
  const { username, name, email, password, is_admin, slack_user_id, roles } = req.body;
  const user = await updateUser(id, { username, name, email, password, is_admin, slack_user_id, roles });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

/** DELETE /api/users/:id — delete a user */
router.delete('/:id', (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });
  if (req.user?.id === id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const ok = deleteUser(id);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

/** GET /api/users/audit/:workflowId — audit trail for a workflow's checkpoints */
router.get('/audit/:workflowId', (req: AuthRequest, res: Response) => {
  const { workflowId } = req.params;
  const rows = db.prepare<[string], {
    id: number; checkpoint_id: number; stage: string;
    user_name: string; user_email: string; action: string;
    notes: string | null; created_at: number;
  }>(`
    SELECT ca.id, ca.checkpoint_id, c.stage, ca.user_name, ca.user_email, ca.action, ca.notes, ca.created_at
    FROM checkpoint_audit ca
    JOIN checkpoints c ON c.id = ca.checkpoint_id
    WHERE c.workflow_id = ?
    ORDER BY ca.created_at ASC
  `).all(workflowId);
  res.json({ audit: rows });
});

export default router;
