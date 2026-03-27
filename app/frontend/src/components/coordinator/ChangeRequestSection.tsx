import { STAGE_LABELS } from '../../constants/stage-labels';

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
      <div className="space-y-2 bg-purple-50 dark:bg-purple-900/10 rounded-lg p-3 border border-purple-200 dark:border-purple-800">
        <p className="text-xs font-medium text-purple-700 dark:text-purple-300">New Change Request</p>
        <select
          value={crType}
          onChange={(e) => onCRTypeChange(e.target.value)}
          className="w-full rounded-md border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="correction">Correction</option>
          <option value="scope">Scope Change</option>
          <option value="direction">Direction Change</option>
          <option value="constraint">New Constraint</option>
          <option value="stakeholder">Stakeholder Feedback</option>
          <option value="technical">Technical Change</option>
        </select>
        <textarea
          value={crDescription}
          onChange={(e) => onCRDescriptionChange(e.target.value)}
          placeholder="Describe what changed and why..."
          rows={3}
          className="w-full resize-none rounded-md border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="flex gap-2">
          <button
            onClick={onSubmitAssess}
            disabled={!crDescription.trim() || crLoading}
            className="flex-1 py-1.5 px-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs font-medium rounded-md transition-colors"
          >
            {crLoading ? 'Assessing...' : 'Submit & Assess Impact'}
          </button>
          <button
            onClick={onCancel}
            className="py-1.5 px-3 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // CR assessment result — stage selection
  if (crAssessment) {
    return (
      <div className="space-y-2 bg-purple-50 dark:bg-purple-900/10 rounded-lg p-3 border border-purple-200 dark:border-purple-800">
        <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
          Impact Assessment — {crAssessment.affected_stages.length} stage(s) affected
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400">{crAssessment.summary}</p>
        <div className="flex flex-wrap gap-2">
          {crAssessment.affected_stages.map(stage => (
            <label key={stage} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={crConfirmedStages[stage] ?? false}
                onChange={() => onToggleConfirmedStage(stage)}
                className="rounded border-slate-300 dark:border-slate-600 text-purple-600 focus:ring-purple-500"
              />
              {STAGE_LABELS[stage] ?? stage}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onApplyChanges}
            disabled={crLoading || Object.values(crConfirmedStages).every(v => !v)}
            className="flex-1 py-1.5 px-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs font-medium rounded-md transition-colors"
          >
            {crLoading ? 'Applying...' : 'Apply Changes'}
          </button>
          <button
            onClick={onCancel}
            className="py-1.5 px-3 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return null;
}
