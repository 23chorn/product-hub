import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from './workflowStore';
import type { CoordinatorMessage, WorkflowRow, WorkflowStatus } from './workflowStore';

const MSG_KEY = 'workflow-coordinator-messages:';
const EVENT_KEY = 'workflow-last-event-id:';

const store = () => useWorkflowStore.getState();

function coordMsg(content: string, extra: Partial<CoordinatorMessage> = {}): CoordinatorMessage {
  return { role: 'coordinator', content, timestamp: 1, ...extra };
}

function progressMsg(stage: string, content: string): CoordinatorMessage {
  return { role: 'coordinator', content, timestamp: 1, isProgress: true, stage };
}

const workflow: WorkflowRow = {
  id: 'wf-1',
  goal: 'Ship it',
  summary: null,
  status: 'active',
  stage_sequence: JSON.stringify(['analyst', 'pm_prd']),
} as WorkflowRow;

beforeEach(() => {
  localStorage.clear();
  store().resetWorkflow();
  // resetWorkflow doesn't touch messages/studioOutput — clear them explicitly.
  useWorkflowStore.setState({ coordinatorMessages: [], studioOutput: {}, lastEventId: 0 });
});

describe('coordinator message actions', () => {
  it('adds a message and persists it when a workflow is active', () => {
    useWorkflowStore.setState({ activeWorkflow: workflow });
    store().addCoordinatorMessage(coordMsg('hello'));

    expect(store().coordinatorMessages).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`${MSG_KEY}wf-1`)!)).toHaveLength(1);
  });

  it('updates state but does not persist when no workflow is active', () => {
    store().addCoordinatorMessage(coordMsg('hello'));
    expect(store().coordinatorMessages).toHaveLength(1);
    expect(localStorage.getItem(`${MSG_KEY}wf-1`)).toBeNull();
  });

  it('appends a chunk to the last message', () => {
    useWorkflowStore.setState({ coordinatorMessages: [coordMsg('foo')] });
    store().appendToLastCoordinatorMessage('bar');
    expect(store().coordinatorMessages[0].content).toBe('foobar');
  });

  it('appendToLastCoordinatorMessage is a no-op on an empty list', () => {
    store().appendToLastCoordinatorMessage('bar');
    expect(store().coordinatorMessages).toEqual([]);
  });

  it('replaces the last message content with a string', () => {
    useWorkflowStore.setState({ coordinatorMessages: [coordMsg('old')] });
    store().replaceLastCoordinatorMessage('new');
    expect(store().coordinatorMessages[0].content).toBe('new');
    expect(store().coordinatorMessages[0].role).toBe('coordinator');
  });

  it('replaces the last message wholesale with a message object', () => {
    useWorkflowStore.setState({ coordinatorMessages: [coordMsg('old')] });
    const replacement = coordMsg('fresh', { eventType: 'stage_complete' });
    store().replaceLastCoordinatorMessage(replacement);
    expect(store().coordinatorMessages[0]).toEqual(replacement);
  });

  it('clearCoordinatorMessages empties state and persists []', () => {
    useWorkflowStore.setState({ activeWorkflow: workflow, coordinatorMessages: [coordMsg('x')] });
    store().clearCoordinatorMessages();
    expect(store().coordinatorMessages).toEqual([]);
    expect(JSON.parse(localStorage.getItem(`${MSG_KEY}wf-1`)!)).toEqual([]);
  });
});

describe('upsertProgressMessage', () => {
  it('updates an existing progress line for the same stage in place', () => {
    useWorkflowStore.setState({ coordinatorMessages: [progressMsg('analyst', 'working 10%')] });
    store().upsertProgressMessage(progressMsg('analyst', 'working 80%'));

    expect(store().coordinatorMessages).toHaveLength(1);
    expect(store().coordinatorMessages[0].content).toBe('working 80%');
  });

  it('keeps a separate line per stage for parallel feature refinements', () => {
    useWorkflowStore.setState({ coordinatorMessages: [progressMsg('story_decomposition_F1', 'F1 25%')] });
    store().upsertProgressMessage(progressMsg('story_decomposition_F2', 'F2 25%'));
    store().upsertProgressMessage(progressMsg('story_decomposition_F1', 'F1 90%'));

    const contents = store().coordinatorMessages.map(m => m.content);
    expect(contents).toEqual(['F1 90%', 'F2 25%']);
  });

  it('appends a new line for a non-progress trailing message', () => {
    useWorkflowStore.setState({ coordinatorMessages: [coordMsg('plain', { stage: 'analyst' })] });
    store().upsertProgressMessage(progressMsg('analyst', 'progress'));
    // The plain message is not isProgress, so the progress line is appended, not merged.
    expect(store().coordinatorMessages).toHaveLength(2);
  });
});

describe('applyWorkflowStatus', () => {
  it('parses the stage sequence, records the active workflow id, and hydrates cached messages', () => {
    localStorage.setItem(`${MSG_KEY}wf-1`, JSON.stringify([coordMsg('cached')]));
    localStorage.setItem(`${EVENT_KEY}wf-1`, '42');

    store().applyWorkflowStatus({
      workflow,
      checkpoints: [],
      currentStage: 'analyst',
      completedStages: [],
      pendingStage: null,
    } as unknown as WorkflowStatus);

    const s = store();
    expect(s.stageSequence).toEqual(['analyst', 'pm_prd']);
    expect(localStorage.getItem('activeWorkflowId')).toBe('wf-1');
    expect(s.coordinatorMessages).toHaveLength(1);
    expect(s.lastEventId).toBe(42);
  });

  it('derives pendingStages and inProgressStages from the scalar fields when lists are absent', () => {
    store().applyWorkflowStatus({
      workflow,
      checkpoints: [],
      currentStage: 'pm_prd',
      completedStages: ['analyst'],
      pendingStage: 'pm_prd',
    } as unknown as WorkflowStatus);

    expect(store().pendingStages).toEqual(['pm_prd']);
    expect(store().inProgressStages).toEqual(['pm_prd']);
  });
});

describe('studioOutput', () => {
  it('appends lines per workflow id', () => {
    store().appendStudioLines('wf-1', ['a', 'b']);
    store().appendStudioLines('wf-1', ['c']);
    store().appendStudioLines('wf-2', ['x']);
    expect(store().studioOutput).toEqual({ 'wf-1': ['a', 'b', 'c'], 'wf-2': ['x'] });
  });

  it('clears only the targeted workflow id', () => {
    useWorkflowStore.setState({ studioOutput: { 'wf-1': ['a'], 'wf-2': ['x'] } });
    store().clearStudioOutput('wf-1');
    expect(store().studioOutput).toEqual({ 'wf-2': ['x'] });
  });
});

describe('resetWorkflow', () => {
  it('clears active workflow state and the stored workflow id', () => {
    useWorkflowStore.setState({ activeWorkflow: workflow, currentStage: 'analyst', isStreaming: true });
    localStorage.setItem('activeWorkflowId', 'wf-1');

    store().resetWorkflow();

    expect(store().activeWorkflow).toBeNull();
    expect(store().currentStage).toBeNull();
    expect(store().isStreaming).toBe(false);
    expect(localStorage.getItem('activeWorkflowId')).toBeNull();
  });
});

describe('setLastEventId', () => {
  it('persists the last event id when a workflow is active', () => {
    useWorkflowStore.setState({ activeWorkflow: workflow });
    store().setLastEventId(99);
    expect(store().lastEventId).toBe(99);
    expect(localStorage.getItem(`${EVENT_KEY}wf-1`)).toBe('99');
  });
});
