/** Shared types for the API client modules. */

export interface SkillVersion {
  id: number;
  skill_name: string;
  agent_type: string;
  version: string;
  owner_team: string;
  discipline: string;
  persona_prompt: string;
  output_format_template: string | null;
  stage_brief_label: string | null;
  stage_brief_format: string | null;
  development_context: string | null;
  tool_definitions: string | null;
  created_at: number;
  deprecated_at: number | null;
}
