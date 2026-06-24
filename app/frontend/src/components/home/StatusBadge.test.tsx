import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
import type { WorkflowInfo } from './types';

const wf = (over: Partial<WorkflowInfo>): WorkflowInfo => ({
  id: 'w', status: 'active', currentStage: null, summary: null, ...over,
});

describe('<StatusBadge>', () => {
  it('shows "Not started" without a workflow', () => {
    render(<StatusBadge />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('shows "Running" for an active workflow', () => {
    render(<StatusBadge wf={wf({ status: 'active' })} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('shows "Done" for a fully complete workflow', () => {
    render(<StatusBadge wf={wf({ status: 'complete', pipelineStatus: 'complete' })} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows "Stopped" for a cancelled workflow', () => {
    render(<StatusBadge wf={wf({ status: 'complete', isCancelled: true })} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('includes the pending stage in the review label', () => {
    render(<StatusBadge wf={wf({ status: 'paused_at_checkpoint', pendingStage: 'pm_prd' })} />);
    expect(screen.getByText(/Review ·/)).toBeInTheDocument();
  });
});
