import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { mockStreamAI } from '../helpers/mock-stream-ai';
import { createWorkflow, advanceStage } from '../../app/backend/src/routes/workflow-router';
import type Database from 'better-sqlite3';

describe('workflow-router', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    mockStreamAI('Here is a brief plan: 1. Define scope, 2. Identify stakeholders, 3. Draft PRD.');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('createWorkflow inserts a pending workflow row', () => {
    const workflow = createWorkflow('Build a user authentication system', db);

    expect(workflow.id).toBeTruthy();
    expect(workflow.goal).toBe('Build a user authentication system');
    expect(workflow.status).toBe('pending');
    expect(workflow.stage).toBeNull();

    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflow.id) as typeof workflow;
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending');
  });

  it('advanceStage calls the LLM mock and writes an artifact + updates status', async () => {
    const workflow = createWorkflow('Improve onboarding flow', db);

    await advanceStage(workflow.id, db);

    const updated = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflow.id) as typeof workflow;
    expect(updated.status).toBe('complete');
    expect(updated.stage).toBe('planning');

    const artifact = db.prepare(
      'SELECT * FROM workflow_artifacts WHERE workflow_id = ?'
    ).get(workflow.id) as { content: string; stage: string } | undefined;
    expect(artifact).toBeTruthy();
    expect(artifact!.stage).toBe('planning');
    expect(artifact!.content).toContain('brief plan');
  });
});
