import type { ExtractedTool } from './types';

/** Read-only detail pane for a tool extracted from a skill, with a jump-to-skill action. */
export function ToolViewer({ tool, onGoToSkill }: { tool: ExtractedTool; onGoToSkill: () => void }) {
  return (
    <>
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-100">{tool.name}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Defined in <span className="font-medium">{tool.sourceSkillName}</span> v{tool.sourceSkillVersion}
            </p>
          </div>
          <button
            onClick={onGoToSkill}
            className="text-xs px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
          >
            Edit in skill →
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{tool.description}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Input Schema</p>
          <pre className="text-xs font-mono bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(tool.input_schema, null, 2)}
          </pre>
        </div>
      </div>
    </>
  );
}
