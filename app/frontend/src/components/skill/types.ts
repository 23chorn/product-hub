/** Shared types and constants for the Skill Manager panel and its sub-components. */
import type { SkillVersion } from '../../services/api';

export interface ContextFile {
  fileName: string;
  label: string;
  description: string;
  hasTemplate: boolean;
  content: string;
  templateContent?: string;
}

export interface PersonaFile {
  name: string;
  displayName: string;
  agentType: string;
  skillName: string;
  content: string;
  frontmatter: string;
}

export interface ExtractedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  sourceSkillName: string;
  sourceSkillVersion: string;
}

export interface ContextFileVersion {
  id: number;
  file_name: string;
  content: string;
  created_at: number;
}

export type Discipline = 'all' | 'dev' | 'qa' | 'design' | 'general';
export type ContentTab = 'persona' | 'dev_context' | 'tools' | 'template';

/** An entry in the Agents section: either a persona file (optionally backed by a published skill) or a custom agent skill. */
export type AgentItem =
  | { type: 'persona'; key: string; persona: PersonaFile; publishedSkill: SkillVersion | null; displayName: string }
  | { type: 'skill'; key: string; skill: SkillVersion; displayName: string };

export type PanelSelection =
  | { type: 'context'; index: number }
  | { type: 'skill'; skill: SkillVersion }
  | { type: 'tool'; tool: ExtractedTool }
  | { type: 'new_context' }
  | { type: 'new_skill' }
  | { type: 'new_agent' }
  | null;

export const DISCIPLINE_LABELS: Record<string, string> = {
  dev:     'Dev',
  qa:      'QA',
  design:  'Design',
  general: 'General',
};

export const DISCIPLINE_COLORS: Record<string, string> = {
  agent:   'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  dev:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  qa:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  design:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  general: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

export function bumpPatch(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
  return version;
}
