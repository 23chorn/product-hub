/**
 * Seed script: creates sample users covering every role combination.
 * Idempotent — skips users whose username already exists.
 * Run with: npx tsx src/scripts/seed-users.ts
 */

import { createUser, getUserByUsername, listUsers } from '../data/users';

const SAMPLE_USERS = [
  {
    username: 'admin',
    name: 'Alice Admin',
    password: 'password123',
    is_admin: true,
    roles: ['product', 'tech_lead', 'design', 'qa'],
    slack_user_id: 'U01ADMIN',
  },
  {
    username: 'product',
    name: 'Pat Product',
    password: 'password123',
    is_admin: false,
    roles: ['product'],
    slack_user_id: 'U02PRODUCT',
  },
  {
    username: 'tech',
    name: 'Taylor Tech',
    password: 'password123',
    is_admin: false,
    roles: ['tech_lead'],
    slack_user_id: 'U03TECH',
  },
  {
    username: 'design',
    name: 'Devon Design',
    password: 'password123',
    is_admin: false,
    roles: ['design'],
    slack_user_id: null,
  },
  {
    username: 'fullstack',
    name: 'Sam Fullstack',
    password: 'password123',
    is_admin: false,
    roles: ['product', 'tech_lead'],
    slack_user_id: null,
  },
  {
    username: 'qa',
    name: 'Quinn QA',
    password: 'password123',
    is_admin: false,
    roles: ['qa'],
    slack_user_id: null,
  },
  {
    username: 'viewer',
    name: 'Vera Viewer',
    password: 'password123',
    is_admin: false,
    roles: ['view_only'],
    slack_user_id: null,
  },
];

async function main() {
  for (const u of SAMPLE_USERS) {
    const existing = getUserByUsername(u.username);
    if (existing) {
      console.log(`  skip     @${u.username} (already exists)`);
      continue;
    }
    const created = await createUser(u as any);
    console.log(`  created  @${created.username.padEnd(12)} ${created.name.padEnd(20)} roles: [${created.roles.join(', ')}]${created.is_admin ? '  ADMIN' : ''}`);
  }

  console.log('\nTest accounts (all passwords: password123):\n');
  for (const u of SAMPLE_USERS) {
    const roleStr = u.roles.length ? u.roles.join(', ') : 'none';
    console.log(`  @${u.username.padEnd(12)} ${u.name.padEnd(20)} roles: [${roleStr}]${u.is_admin ? '  ADMIN' : ''}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
