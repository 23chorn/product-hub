import { describe, it, expect } from 'vitest';
import { effectiveStatus, type WorkflowInfo } from './types';

const wf = (over: Partial<WorkflowInfo>): WorkflowInfo => ({
  id: 'w', status: 'active', currentStage: null, summary: null, ...over,
});

describe('effectiveStatus', () => {
  it('reports cancelled when the workflow was cancelled', () => {
    expect(effectiveStatus(wf({ status: 'complete', isCancelled: true }))).toBe('cancelled');
  });

  it('treats a complete workflow with a lagging pipeline as still active', () => {
    expect(effectiveStatus(wf({ status: 'complete', pipelineStatus: 'running' }))).toBe('active');
  });

  it('reports complete when the pipeline has also completed', () => {
    expect(effectiveStatus(wf({ status: 'complete', pipelineStatus: 'complete' }))).toBe('complete');
  });

  it('passes the raw status through otherwise', () => {
    expect(effectiveStatus(wf({ status: 'paused_at_checkpoint' }))).toBe('paused_at_checkpoint');
  });

  it('reports active for a resumed workflow even though its old workflow_cancelled event still makes isCancelled true', () => {
    // reiterateFromStage flips status back to 'active' but never deletes the original stop's
    // workflow_cancelled event, so isCancelled stays true forever — effectiveStatus must not
    // let that stale flag override a since-resumed 'active' status.
    expect(effectiveStatus(wf({ status: 'active', isCancelled: true }))).toBe('active');
  });
});
