import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditTrailPanel } from './AuditTrailPanel';

const getWorkflowAudit = vi.fn();
vi.mock('../../services/api', () => ({
  api: { getWorkflowAudit: (id: string) => getWorkflowAudit(id) },
}));

const entry = (over: Record<string, unknown> = {}) => ({
  id: 1, checkpoint_id: 1, stage: 'pm_prd',
  user_name: 'Ada Lovelace', user_email: 'ada@x.io',
  action: 'approved', notes: null, created_at: Date.now(), ...over,
});

describe('<AuditTrailPanel>', () => {
  beforeEach(() => getWorkflowAudit.mockReset());

  it('renders who reviewed which stage with the action verb', async () => {
    getWorkflowAudit.mockResolvedValue({ audit: [entry()] });
    render(<AuditTrailPanel workflowId="w1" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    expect(screen.getByText(/approved/)).toBeInTheDocument();
    expect(getWorkflowAudit).toHaveBeenCalledWith('w1');
  });

  it('shows reviewer notes when present', async () => {
    getWorkflowAudit.mockResolvedValue({ audit: [entry({ action: 'revised', notes: 'tighten the metrics' })] });
    render(<AuditTrailPanel workflowId="w1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('tighten the metrics')).toBeInTheDocument());
    expect(screen.getByText(/requested changes to/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no actions', async () => {
    getWorkflowAudit.mockResolvedValue({ audit: [] });
    render(<AuditTrailPanel workflowId="w1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No review actions recorded/)).toBeInTheDocument());
  });
});
