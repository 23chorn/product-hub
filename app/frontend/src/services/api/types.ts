/** Shared types for the API client modules. */

/** An editable agent definition file — a persona (agents/personas/*.md) or output template (agents/templates/*.md). */
export interface AgentFile {
  key: string;
  dir: 'personas' | 'templates';
  editRoles: string[] | null;
}

export interface AgentFileContent {
  key: string;
  dir: 'personas' | 'templates';
  content: string;
}
