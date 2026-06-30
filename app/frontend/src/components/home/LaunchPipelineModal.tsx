import { useState } from 'react';
import type { EnrichedItem, LaunchPhase, StageOption, WorkflowPreset } from './types';
import { useAuthStore } from '../../stores/authStore';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';

interface LaunchPipelineModalProps {
  item: EnrichedItem;
  phase: LaunchPhase;
  selectedPreset: WorkflowPreset;
  fullStages: StageOption[];
  smallStages: StageOption[];
  onSelectPreset: (preset: WorkflowPreset) => void;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function StagePills({ stages }: { stages: StageOption[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {stages.map(s => (
        <span
          key={s.key}
          className="px-2 py-0.5 text-[10px] rounded-md bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-surface-600"
        >
          {s.short}
        </span>
      ))}
    </div>
  );
}

/** Modal that lets the user choose Full or Small pipeline and launches the workflow.
 *  Product users can edit the description before launch (syncs to Airtable if source is airtable). */
export function LaunchPipelineModal({
  item,
  phase,
  selectedPreset,
  fullStages,
  smallStages,
  onSelectPreset,
  error,
  onConfirm,
  onCancel,
}: LaunchPipelineModalProps) {
  const { user, noAuth } = useAuthStore();
  const toast = useToast();
  // Allow editing if: no-auth mode, OR has product role, OR is admin
  const canEditDescription = noAuth || user?.roles?.includes('product') || user?.is_admin || false;

  const [step, setStep] = useState<'description' | 'pipeline'>('description');
  const [description, setDescription] = useState(item.description || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isSavingDescription, setIsSavingDescription] = useState(false);

  const handleSaveDescription = async () => {
    setIsSavingDescription(true);
    try {
      await api.updateItemDescription(item.id, description);
      toast.success('Description updated');
      setIsEditingDescription(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to update description');
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleNext = () => {
    if (isEditingDescription) {
      toast.error('Please save or cancel your description edits first');
      return;
    }
    setStep('pipeline');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 px-4">
      <div className="w-full max-w-3xl max-h-[90vh] bg-white dark:bg-surface-800 rounded-2xl shadow-xl border border-surface-200 dark:border-surface-700 overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-surface-100 dark:border-surface-700 flex-shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1">
            {phase === 'launching' ? 'Launching' : step === 'description' ? 'Step 1: Review Description' : 'Step 2: Configure Pipeline'}
          </p>
          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {item.initiative}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Step 1: Description Review */}
          {phase === 'confirming' && step === 'description' && canEditDescription && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                    Initiative Description
                  </label>
                  {!isEditingDescription && (
                    <button
                      onClick={() => setIsEditingDescription(true)}
                      className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium"
                    >
                      {description ? 'Edit' : 'Add description'}
                    </button>
                  )}
                </div>

                {isEditingDescription ? (
                  <div className="space-y-2">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Add context for this initiative (syncs to Airtable)..."
                      className="w-full px-3 py-2.5 text-xs border border-surface-200 dark:border-surface-600 rounded-lg bg-white dark:bg-surface-750 text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 resize-none font-mono leading-relaxed"
                      rows={8}
                      disabled={isSavingDescription}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveDescription}
                        disabled={isSavingDescription}
                        className="px-4 py-2 text-xs font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                      >
                        {isSavingDescription ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setDescription(item.description || '');
                          setIsEditingDescription(false);
                        }}
                        disabled={isSavingDescription}
                        className="px-4 py-2 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : description ? (
                  <div className="text-xs text-surface-700 dark:text-surface-300 leading-relaxed p-3 bg-surface-50 dark:bg-surface-750 rounded-lg border border-surface-200 dark:border-surface-600 max-h-48 overflow-y-auto">
                    <pre className="whitespace-pre-wrap font-sans">{description}</pre>
                  </div>
                ) : (
                  <p className="text-xs text-surface-400 dark:text-surface-500 italic">
                    No description provided
                  </p>
                )}
              </div>

              {/* Next Button for Description Step */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleNext}
                  disabled={isEditingDescription || isSavingDescription}
                  className="flex-1 py-3 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                >
                  Next →
                </button>
                <button
                  onClick={onCancel}
                  disabled={isSavingDescription}
                  className="px-5 py-3 text-sm text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Pipeline Selection */}
          {phase === 'confirming' && step === 'pipeline' && (
            <div className="space-y-4">
              <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                Choose which workflow pipeline to run for this initiative.
              </p>

              {/* Pipeline selection */}
              <div className="grid grid-cols-2 gap-2">
            {/* Full Pipeline */}
            <button
              type="button"
              onClick={() => onSelectPreset('full')}
              className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                selectedPreset === 'full'
                  ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-750 hover:border-surface-300 dark:hover:border-surface-500'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  selectedPreset === 'full'
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-surface-300 dark:border-surface-500'
                }`} />
                <span className="text-xs font-semibold text-surface-800 dark:text-surface-100">Full Pipeline</span>
              </div>
              <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-snug mb-1">
                Research through to backlog — all specialist stages.
              </p>
              <StagePills stages={fullStages} />
            </button>

            {/* Small Workflow */}
            <button
              type="button"
              onClick={() => onSelectPreset('small')}
              className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                selectedPreset === 'small'
                  ? 'border-brand-400 dark:border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-750 hover:border-surface-300 dark:hover:border-surface-500'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  selectedPreset === 'small'
                    ? 'border-brand-500 bg-brand-500'
                    : 'border-surface-300 dark:border-surface-500'
                }`} />
                <span className="text-xs font-semibold text-surface-800 dark:text-surface-100">Small Workflow</span>
              </div>
              <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-snug mb-1">
                PRD → architecture → features → tickets. Skips research.
              </p>
              <StagePills stages={smallStages} />
            </button>
              </div>

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}

              {/* Launch/Back Buttons for Pipeline Step */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep('description')}
                  className="px-5 py-3 text-sm text-surface-600 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 py-3 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-xl transition-colors"
                >
                  Launch pipeline →
                </button>
              </div>
            </div>
          )}

          {/* Launching Phase (after confirmation) */}
          {phase === 'launching' && (
            <div className="text-center py-8">
              <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <p className="text-sm text-surface-600 dark:text-surface-400">Launching workflow...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
