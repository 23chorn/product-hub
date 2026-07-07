import { describe, it, expect, vi } from 'vitest';

// behaviour-files.ts imports db at module load time (for recordBehaviourFileVersion) —
// mock it the same way other agent tests do so this pure-function suite never touches
// the real product-ops.db.
vi.mock('../../app/backend/src/data/database', async () => {
  const { createTestDb } = await import('../helpers/test-db');
  return { default: createTestDb() };
});

import { applyBehaviourDiff } from '../../app/backend/src/agents/behaviour-files';

describe('applyBehaviourDiff', () => {
  it('creates a brand-new file verbatim when existingContent is null', () => {
    const content = 'Feature: Password Reset\n\nScenario: User resets a forgotten password\n  Given ...\n';
    const result = applyBehaviourDiff(null, { section: 'User resets a forgotten password', action: 'add', content });
    expect(result).toBe(content.trim() + '\n');
  });

  it('appends a new scenario to an existing file', () => {
    const existing = 'Feature: Password Reset\n\nScenario: User resets a forgotten password\n  Given a user on the login screen\n';
    const result = applyBehaviourDiff(existing, {
      section: 'User enters an invalid reset code',
      action: 'add',
      content: 'Scenario: User enters an invalid reset code\n  Given a user on the reset screen\n  Then an error is shown',
    });
    expect(result).toContain('Scenario: User resets a forgotten password');
    expect(result).toContain('Scenario: User enters an invalid reset code');
  });

  it('updates an existing named scenario in place', () => {
    const existing = [
      'Feature: Password Reset',
      '',
      'Scenario: User resets a forgotten password',
      '  Given the old behavior',
      '',
      'Scenario: Another scenario',
      '  Given something else',
      '',
    ].join('\n');

    const result = applyBehaviourDiff(existing, {
      section: 'User resets a forgotten password',
      action: 'update',
      content: 'Scenario: User resets a forgotten password\n  Given the new behavior',
    });

    expect(result).toContain('Given the new behavior');
    expect(result).not.toContain('Given the old behavior');
    expect(result).toContain('Scenario: Another scenario');
  });

  it('removes a named scenario entirely', () => {
    const existing = [
      'Feature: Password Reset',
      '',
      'Scenario: User resets a forgotten password',
      '  Given something',
      '',
      'Scenario: Deprecated flow',
      '  Given something old',
      '',
    ].join('\n');

    const result = applyBehaviourDiff(existing, { section: 'Deprecated flow', action: 'remove', content: '' });

    expect(result).not.toContain('Deprecated flow');
    expect(result).toContain('User resets a forgotten password');
  });

  it('no-ops when updating/removing a scenario name that does not exist', () => {
    const existing = 'Feature: Password Reset\n\nScenario: Existing one\n  Given X\n';
    const result = applyBehaviourDiff(existing, { section: 'Does not exist', action: 'update', content: 'Scenario: Does not exist\n  Given Y' });
    expect(result).toBe(existing.endsWith('\n') ? existing : existing + '\n');
  });
});
