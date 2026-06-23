/** Shared types and constants for the Skill Manager panel and its sub-components. */

export interface ContextFile {
  fileName: string;
  label: string;
  description: string;
  hasTemplate: boolean;
  content: string;
  templateContent?: string;
  stages: string[] | null;
  editRoles: string[] | null;
}

export interface ContextFileVersion {
  id: number;
  file_name: string;
  content: string;
  created_at: number;
}

export type PanelSelection =
  | { type: 'context'; index: number }
  | { type: 'behaviour'; index: number }
  | { type: 'agent_file'; key: string }
  | { type: 'new_context' }
  | { type: 'airtable_sync' }
  | { type: 'doc_file'; fileId: number }
  | null;
