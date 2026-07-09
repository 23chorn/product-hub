import { STAGE_LABELS } from '../../constants/stage-labels';
import { FieldLabel } from '../common/FieldLabel';

interface ChangeRequestSectionProps {
  showForm: boolean;
  crType: string;
  onCRTypeChange: (type: string) => void;
  crDescription: string;
  onCRDescriptionChange: (desc: string) => void;
  crAssessment: { affected_stages: string[]; summary: string } | null;
  crConfirmedStages: Record<string, boolean>;
  onToggleConfirmedStage: (stage: string) => void;
  crLoading: boolean;
  onSubmitAssess: () => void;
  onApplyChanges: () => void;
  onCancel: () => void;
}

export function ChangeRequestSection({
  showForm,
  crType,
  onCRTypeChange,
  crDescription,
  onCRDescriptionChange,
  crAssessment,
  crConfirmedStages,
  onToggleConfirmedStage,
  crLoading,
  onSubmitAssess,
  onApplyChanges,
  onCancel,
}: ChangeRequestSectionProps) {
  // CR form
  if (showForm && !crAssessment) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-lg space-y-3 bg-surface-50 dark:bg-surface-900 rounded-xl shadow-xl p-4 border border-cyan-200 dark:border-cyan-800 mx-4">
        <p className="text-xs font-mono font-semibold text-cyan-700 dark:text-cyan-300">
          <span className="text-cyan-500">&gt;</span> new change request
        </p>
        <div>
          <FieldLabel>type</FieldLabel>
          <select
            value={crType}
            onChange={(e) => onCRTypeChange(e.target.value)}
            className="w-full rounded-md border border-cyan-300 dark:border-cyan-700 bg-surface-50 dark:bg-surface-900 px-2 py-1.5 text-xs font-mono text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="correction">Correction</option>
            <option value="scope">Scope Change</option>
            <option value="direction">Direction Change</option>
            <option value="constraint">New Constraint</option>
            <option value="stakeholder">Stakeholder Feedback</option>
            <option value="technical">Technical Change</option>
          </select>
        </div>
        <div>
          <FieldLabel>description</FieldLabel>
          <textarea
            value={crDescription}
            onChange={(e) => onCRDescriptionChange(e.target.value)}
            placeholder="describe what changed and why…"
            rows={3}
            className="w-full resize-none rounded-md border border-cyan-300 dark:border-cyan-700 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm font-mono text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSubmitAssess}
            disabled={!crDescription.trim() || crLoading}
            className="flex-1 py-1.5 px-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-xs font-mono font-medium rounded-md transition-colors"
          >
            {crLoading ? 'assessing…' : 'assess impact →'}
          </button>
          <button
            onClick={onCancel}
            className="py-1.5 px-3 text-xs font-mono text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
          >
            cancel
          </button>
        </div>
      </div>
      </div>
    );
  }

  // CR assessment result — stage selection
  if (crAssessment) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 dark:bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-lg space-y-2 bg-surface-50 dark:bg-surface-900 rounded-xl shadow-xl p-4 border border-cyan-200 dark:border-cyan-800 mx-4">
        <p className="text-xs font-mono font-semibold text-cyan-700 dark:text-cyan-300">
          <span className="text-cyan-500">&gt;</span> impact assessment — {crAssessment.affected_stages.length} stage(s) affected
        </p>
        <p className="text-xs text-surface-600 dark:text-surface-400">{crAssessment.summary}</p>
        <div className="flex flex-wrap gap-2">
          {crAssessment.affected_stages.map(stage => (
            <label key={stage} className="flex items-center gap-1.5 text-xs font-mono text-surface-700 dark:text-surface-300">
              <input
                type="checkbox"
                checked={crConfirmedStages[stage] ?? false}
                onChange={() => onToggleConfirmedStage(stage)}
                className="rounded border-surface-300 dark:border-surface-600 text-cyan-600 focus:ring-cyan-500"
              />
              {STAGE_LABELS[stage] ?? stage}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onApplyChanges}
            disabled={crLoading || Object.values(crConfirmedStages).every(v => !v)}
            className="flex-1 py-1.5 px-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white text-xs font-mono font-medium rounded-md transition-colors"
          >
            {crLoading ? 'applying…' : 'apply changes →'}
          </button>
          <button
            onClick={onCancel}
            className="py-1.5 px-3 text-xs font-mono text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
          >
            cancel
          </button>
        </div>
      </div>
      </div>
    );
  }

  return null;
}
