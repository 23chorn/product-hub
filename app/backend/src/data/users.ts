import db from './database';
import bcrypt from 'bcryptjs';

export interface User {
  id: number;
  username: string;
  email: string | null;
  name: string;
  is_admin: boolean;
  slack_user_id: string | null;
  roles: string[];
  created_at: number;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  name: string;
  password_hash: string;
  is_admin: number;
  slack_user_id: string | null;
  created_at: number;
  updated_at: number;
}

function attachRoles(row: UserRow): User {
  const roleRows = db.prepare<[number], { role_name: string }>(
    'SELECT role_name FROM user_roles WHERE user_id = ?'
  ).all(row.id);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    is_admin: row.is_admin === 1,
    slack_user_id: row.slack_user_id,
    roles: roleRows.map(r => r.role_name),
    created_at: row.created_at,
  };
}

export function getUserByUsername(username: string): UserRow | null {
  return db.prepare<[string], UserRow>(
    'SELECT * FROM users WHERE username = ? COLLATE NOCASE'
  ).get(username) ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
  return db.prepare<[string], UserRow>(
    'SELECT * FROM users WHERE email = ? COLLATE NOCASE'
  ).get(email) ?? null;
}

export function getUserById(id: number): User | null {
  const row = db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
  return row ? attachRoles(row) : null;
}

export function listUsers(): User[] {
  const rows = db.prepare<[], UserRow>('SELECT * FROM users ORDER BY name ASC').all();
  return rows.map(attachRoles);
}

export async function createUser(params: {
  username: string;
  email?: string | null;
  name: string;
  password: string;
  is_admin?: boolean;
  slack_user_id?: string | null;
  roles?: string[];
}): Promise<User> {
  const hash = await bcrypt.hash(params.password, 10);
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO users (username, email, name, password_hash, is_admin, slack_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.username.toLowerCase(),
    params.email ? params.email.toLowerCase() : null,
    params.name,
    hash,
    params.is_admin ? 1 : 0,
    params.slack_user_id ?? null,
    now,
    now,
  );
  const userId = result.lastInsertRowid as number;
  if (params.roles?.length) {
    const insertRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_name) VALUES (?, ?)');
    for (const role of params.roles) insertRole.run(userId, role);
  }
  return getUserById(userId)!;
}

export async function updateUser(id: number, params: {
  username?: string;
  name?: string;
  email?: string | null;
  password?: string;
  is_admin?: boolean;
  slack_user_id?: string | null;
  roles?: string[];
}): Promise<User | null> {
  const row = db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
  if (!row) return null;

  const hash = params.password ? await bcrypt.hash(params.password, 10) : row.password_hash;
  db.prepare(`
    UPDATE users SET username = ?, name = ?, email = ?, password_hash = ?, is_admin = ?, slack_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    (params.username ?? row.username).toLowerCase(),
    params.name ?? row.name,
    params.email !== undefined ? (params.email ? params.email.toLowerCase() : null) : row.email,
    hash,
    params.is_admin !== undefined ? (params.is_admin ? 1 : 0) : row.is_admin,
    params.slack_user_id !== undefined ? params.slack_user_id : row.slack_user_id,
    Date.now(),
    id,
  );

  if (params.roles !== undefined) {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
    const insertRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_name) VALUES (?, ?)');
    for (const role of params.roles) insertRole.run(id, role);
  }

  return getUserById(id);
}

export function deleteUser(id: number): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function verifyPassword(username: string, password: string): Promise<UserRow | null> {
  const row = getUserByUsername(username);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  return ok ? row : null;
}

export function hasAnyUsers(): boolean {
  const row = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM users').get();
  return (row?.count ?? 0) > 0;
}

export function getUsersByRole(roleName: string): User[] {
  const rows = db.prepare<[string], UserRow>(`
    SELECT u.* FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.role_name = ?
    UNION
    SELECT * FROM users WHERE is_admin = 1
  `).all(roleName);
  return rows.map(attachRoles);
}

export function getAdminUsers(): User[] {
  const rows = db.prepare<[], UserRow>('SELECT * FROM users WHERE is_admin = 1').all();
  return rows.map(attachRoles);
}

// Stage-role helpers
export function getStageRoles(): Array<{ stage: string; role_name: string }> {
  return db.prepare<[], { stage: string; role_name: string }>(
    'SELECT stage, role_name FROM stage_roles ORDER BY stage ASC'
  ).all();
}

export function setStageRole(stage: string, roleName: string): void {
  db.prepare('INSERT OR REPLACE INTO stage_roles (stage, role_name) VALUES (?, ?)').run(stage, roleName);
}

export function getAvailableRoles(): Array<{ id: number; name: string; description: string | null }> {
  return db.prepare<[], { id: number; name: string; description: string | null }>(
    'SELECT * FROM roles ORDER BY name ASC'
  ).all();
}
