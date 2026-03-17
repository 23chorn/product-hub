import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import type { AppConfig, RoadmapIntegration, WorkItemsIntegration, KnowledgeBaseIntegration } from '@pap/shared';
import { getActiveProvider, getAvailableModels } from '../utils/ai-provider';

// Load .env before reading any env vars — safe to call multiple times (idempotent)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const AGENTS_ROOT = path.join(PROJECT_ROOT, 'agents');

/** All known specialist stages — defaults to true if not specified in config. */
const ALL_STAGES = ['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'gtm_strategy', 'feature_marketing'];

/** Load enabled_stages from agents/config.yaml. Missing stages default to true. */
function loadEnabledStages(): Record<string, boolean> {
  const result: Record<string, boolean> = Object.fromEntries(ALL_STAGES.map(s => [s, true]));
  try {
    const raw = fs.readFileSync(path.join(AGENTS_ROOT, 'config.yaml'), 'utf-8');
    let inEnabledStages = false;
    for (const line of raw.split('\n')) {
      if (/^enabled_stages:\s*$/.test(line)) { inEnabledStages = true; continue; }
      if (inEnabledStages) {
        const match = line.match(/^\s+(\w+):\s*(true|false)\s*$/);
        if (match && ALL_STAGES.includes(match[1])) {
          result[match[1]] = match[2] === 'true';
        } else if (/^\S/.test(line)) {
          inEnabledStages = false; // left the indented block
        }
      }
    }
  } catch { /* file missing — all stages enabled */ }
  return result;
}

/**
 * Build and validate the AppConfig from environment variables.
 * Throws a descriptive error on startup if a required variable is missing
 * for an enabled integration.
 */
function buildConfigFromEnv(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const useMockData = process.env.USE_MOCK_DATA === 'true';

  // ── Integration flags ────────────────────────────────────────────────────
  // Explicit flag wins; fall back to inferring from credential presence.
  const roadmap = resolveRoadmapIntegration(useMockData);
  const workItems = resolveWorkItemsIntegration();
  const knowledgeBase = resolveKnowledgeBaseIntegration();

  // ── Validation ────────────────────────────────────────────────────────────
  if (roadmap === 'airtable') {
    const missing = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'AIRTABLE_TABLE_NAME']
      .filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `ROADMAP_INTEGRATION=airtable but required env vars are missing: ${missing.join(', ')}.\n` +
        `Set them in .env or change ROADMAP_INTEGRATION=none to disable.`
      );
    }
  }

  if (workItems === 'ado') {
    const missing = ['AZURE_DEVOPS_ORG', 'AZURE_DEVOPS_PROJECT', 'AZURE_DEVOPS_PAT']
      .filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `WORK_ITEMS_INTEGRATION=ado but required env vars are missing: ${missing.join(', ')}.\n` +
        `Set them in .env or change WORK_ITEMS_INTEGRATION=none to disable.`
      );
    }
  }

  if (workItems === 'jira') {
    const missing = ['JIRA_HOST', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY']
      .filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `WORK_ITEMS_INTEGRATION=jira but required env vars are missing: ${missing.join(', ')}.\n` +
        `Set them in .env or change WORK_ITEMS_INTEGRATION=none to disable.`
      );
    }
  }

  if (knowledgeBase === 'notion') {
    const missing = ['NOTION_API_KEY', 'NOTION_DATABASE_ID'].filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `KNOWLEDGE_BASE_INTEGRATION=notion but required env vars are missing: ${missing.join(', ')}.\n` +
        `Set them in .env or change KNOWLEDGE_BASE_INTEGRATION=none to disable.`
      );
    }
  }

  if (knowledgeBase === 'gitbook') {
    const missing = ['GITBOOK_API_TOKEN', 'GITBOOK_SPACE_ID'].filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `KNOWLEDGE_BASE_INTEGRATION=gitbook but required env vars are missing: ${missing.join(', ')}.\n` +
        `Set them in .env or change KNOWLEDGE_BASE_INTEGRATION=none to disable.`
      );
    }
  }

  // ENABLE_WORKFLOW_MODE defaults to true for local use.
  // Set to 'false' to hide the Workflow Mode UI without removing the feature.
  const workflowModeEnabled = process.env.ENABLE_WORKFLOW_MODE !== 'false';

  // ── Stage config from agents/config.yaml ──────────────────────────────────
  const enabledStages = loadEnabledStages();

  return {
    ai: {
      provider: getActiveProvider(),
      models: getAvailableModels(),
    },
    features: {
      workflowMode: 'standard',
      workflowModeEnabled,
    },
    integrations: { roadmap, workItems, knowledgeBase },
    stages: { enabledStages },
    server: { nodeEnv, useMockData },
  };
}

function resolveRoadmapIntegration(useMockData: boolean): RoadmapIntegration {
  const explicit = process.env.ROADMAP_INTEGRATION?.toLowerCase();
  if (explicit === 'airtable') return 'airtable';
  if (explicit === 'none') return 'none';
  // Infer: if mock mode or Airtable keys present, default to airtable
  if (useMockData || process.env.AIRTABLE_API_KEY) return 'airtable';
  return 'none';
}

function resolveWorkItemsIntegration(): WorkItemsIntegration {
  const explicit = process.env.WORK_ITEMS_INTEGRATION?.toLowerCase();
  if (explicit === 'ado') return 'ado';
  if (explicit === 'jira') return 'jira';
  if (explicit === 'none') return 'none';
  // Infer from credential presence
  if (process.env.AZURE_DEVOPS_PAT) return 'ado';
  if (process.env.JIRA_API_TOKEN) return 'jira';
  return 'none';
}

function resolveKnowledgeBaseIntegration(): KnowledgeBaseIntegration {
  const explicit = process.env.KNOWLEDGE_BASE_INTEGRATION?.toLowerCase();
  if (explicit === 'notion') return 'notion';
  if (explicit === 'gitbook') return 'gitbook';
  if (explicit === 'none') return 'none';
  // Infer from credential presence — require all mandatory vars before auto-enabling
  if (process.env.NOTION_API_KEY) return 'notion';
  if (process.env.GITBOOK_API_TOKEN && process.env.GITBOOK_SPACE_ID) return 'gitbook';
  return 'none';
}

// Singleton — built once at startup after dotenv has loaded
export const appConfig: AppConfig = buildConfigFromEnv();
export type { AppConfig };
