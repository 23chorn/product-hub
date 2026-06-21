import { MarkdownEditor } from './MarkdownEditor';

export interface SkillCreateFormProps {
  form: {
    skill_name: string; discipline: string; owner_team: string; agent_type: string;
    version: string; persona_prompt: string; development_context: string;
    tool_definitions: string; output_format_template: string;
  };
  setForm: React.Dispatch<React.SetStateAction<SkillCreateFormProps['form']>>;
  onSubmit: () => void;
  onCancel: () => void;
  isCreating: boolean;
  lockDiscipline?: string;
}

/** Form for authoring a new skill (or agent) and publishing its initial version. */
export function SkillCreateForm({ form, setForm, onSubmit, onCancel, isCreating, lockDiscipline }: SkillCreateFormProps) {
  const field = (key: keyof SkillCreateFormProps['form'], value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const effectiveDiscipline = lockDiscipline ?? form.discipline;
  const primaryLabel = effectiveDiscipline === 'agent' ? 'Persona Prompt' : 'Development Context';
  const primaryKey: keyof SkillCreateFormProps['form'] =
    effectiveDiscipline === 'agent' ? 'persona_prompt' : 'development_context';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Create New Skill</h3>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
          Published as v{form.version} — increment version to publish future updates.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Skill name *</label>
            <input
              value={form.skill_name}
              onChange={(e) => field('skill_name', e.target.value)}
              placeholder="e.g. auth-service-dev"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Discipline *</label>
            {lockDiscipline ? (
              <div className="px-3 py-1.5 text-sm rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-surface-500 dark:text-surface-400 capitalize">
                {lockDiscipline}
              </div>
            ) : (
              <select
                value={form.discipline}
                onChange={(e) => field('discipline', e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="dev">Dev</option>
                <option value="qa">QA</option>
                <option value="design">Design</option>
                <option value="general">General</option>
                <option value="agent">Agent (workflow stage)</option>
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Owner team</label>
            <input
              value={form.owner_team}
              onChange={(e) => field('owner_team', e.target.value)}
              placeholder="e.g. platform-team"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Initial version</label>
            <input
              value={form.version}
              onChange={(e) => field('version', e.target.value)}
              placeholder="1.0.0"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            {primaryLabel}
            <span className="ml-1 font-normal text-surface-400">
              {effectiveDiscipline === 'agent' ? '— agent persona prompt' : '— injected into ADO tickets for this domain'}
            </span>
          </label>
          <div className="h-64">
            <MarkdownEditor
              value={form[primaryKey] as string}
              onChange={(v) => field(primaryKey, v)}
              placeholder={
                effectiveDiscipline === 'agent'
                  ? 'You are a specialist…'
                  : 'Describe development patterns, conventions, API contracts, and code details…'
              }
            />
          </div>
        </div>

        {effectiveDiscipline !== 'agent' && (
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
              Tool Definitions (JSON) <span className="font-normal text-surface-400">— optional</span>
            </label>
            <textarea
              value={form.tool_definitions}
              onChange={(e) => field('tool_definitions', e.target.value)}
              rows={4}
              placeholder='[{"name": "my_tool", "description": "...", "input_schema": {...}}]'
              className="w-full px-3 py-2 text-sm rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex items-center justify-end space-x-2 flex-shrink-0">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={isCreating || !form.skill_name.trim()}
          className="text-xs px-4 py-1.5 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        >
          {isCreating ? 'Creating…' : 'Create Skill'}
        </button>
      </div>
    </div>
  );
}
