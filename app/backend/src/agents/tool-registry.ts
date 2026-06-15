import Logger from '../utils/logger';
import {
  validateAnalystJson,
  validatePrdJson,
  validateArchitectureJson,
  validateBacklogJson,
  validateEpicFeaturesJson,
  validateQaTestsJson,
} from './tool-validators';
import { getContextFile, getDomainSkillContext } from './tool-context';

const logger = new Logger('TOOL-REGISTRY');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<string> | string;

// ── Registry ──────────────────────────────────────────────────────────────────

const _registry = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  _registry.set(name, handler);
  logger.info(`Registered tool: ${name}`);
}

export function getRegisteredTools(): string[] {
  return Array.from(_registry.keys());
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const handler = _registry.get(name);
  if (!handler) throw new Error(`No handler registered for tool "${name}"`);
  logger.info(`[TOOL] ${name} called with: ${JSON.stringify(input).slice(0, 200)}`);
  const result = await handler(input);
  logger.info(`[TOOL] ${name} result: ${String(result).slice(0, 200)}`);
  return result;
}

// ── Register all tools ────────────────────────────────────────────────────────

registerTool('validate_analyst_json',           validateAnalystJson);
registerTool('validate_prd_json',               validatePrdJson);
registerTool('validate_architecture_json',      validateArchitectureJson);
registerTool('validate_backlog_json',           validateBacklogJson);
registerTool('validate_epic_features_json',     validateEpicFeaturesJson);
registerTool('validate_qa_tests_json',          validateQaTestsJson);
registerTool('get_context_file',                getContextFile);
registerTool('get_domain_skill_context',        getDomainSkillContext);
