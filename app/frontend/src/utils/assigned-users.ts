import type { AssignedUser } from '@pap/shared';

/** "Assigned to me" / "Assigned to Jane" / "Assigned to me, Jane" — the viewer's own
 *  name is replaced with "me" instead of collapsing the badge to hide co-assignees. */
export function formatAssignedLabel(users: AssignedUser[], currentUserId?: number): string {
  const names = users.map(u => (u.id === currentUserId ? 'me' : u.name));
  return `Assigned to ${names.join(', ')}`;
}
