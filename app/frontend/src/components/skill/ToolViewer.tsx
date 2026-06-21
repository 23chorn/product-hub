import type { ExtractedTool } from './types';
import { ToolPreviewCard } from './ToolEditor';

/** Read-only detail pane for a tool extracted from a skill, with a jump-to-skill action. */
export function ToolViewer({ tool, onGoToSkill }: { tool: ExtractedTool; onGoToSkill: () => void }) {
  const toolDef = {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };

  return (
    <>
      <div className="px-5 py-3 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold font-mono text-surface-900 dark:text-surface-100">{tool.name}</h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              Defined in <span className="font-medium">{tool.sourceSkillName}</span> v{tool.sourceSkillVersion}
            </p>
          </div>
          <button
            onClick={onGoToSkill}
            className="text-xs px-3 py-1.5 rounded-md bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors font-medium"
          >
            Edit in skill →
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <ToolPreviewCard tool={toolDef} />
      </div>
    </>
  );
}
