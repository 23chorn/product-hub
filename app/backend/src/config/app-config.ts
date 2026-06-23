import dotenv from 'dotenv';
import path from 'path';
import type { AppConfig, RoadmapIntegration, WorkItemsIntegration, KnowledgeBaseIntegration } from '@pap/shared';
import { getActiveProvider, getAvailableModels } from '../utils/ai-provider';
import { getEnabledStages } from './settings-store';

// Load .env before reading any env vars — safe to call multiple times (idempotent)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

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

  if (knowledgeBase === 'azure_wiki') {
    const missing = ['AZURE_DEVOPS_ORG', 'AZURE_DEVOPS_PROJECT', 'AZURE_DEVOPS_PAT']
      .filter(k => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `KNOWLEDGE_BASE_INTEGRATION=azure_wiki but required env vars are missing: ${missing.join(', ')}.\n` +
        `Set them in .env or change KNOWLEDGE_BASE_INTEGRATION=none to disable.`
      );
    }
  }

  // ENABLE_WORKFLOW_MODE defaults to true for local use.
  // Set to 'false' to hide the Workflow Mode UI without removing the feature.
  const workflowModeEnabled = process.env.ENABLE_WORKFLOW_MODE !== 'false';

  // ── Stage config from the settings store (policies table) ─────────────────
  const enabledStages = getEnabledStages();

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
  if (explicit === 'none') return 'none';
  // Infer from credential presence
  if (process.env.AZURE_DEVOPS_PAT) return 'ado';
  return 'none';
}

function resolveKnowledgeBaseIntegration(): KnowledgeBaseIntegration {
  const explicit = process.env.KNOWLEDGE_BASE_INTEGRATION?.toLowerCase();
  if (explicit === 'azure_wiki') return 'azure_wiki';
  // azure_wiki is intentionally NOT inferred from ADO credentials — WORK_ITEMS_INTEGRATION=ado
  // only means work items live in ADO, not that the wiki should be used as the knowledge base.
  // Set KNOWLEDGE_BASE_INTEGRATION=azure_wiki explicitly to opt in.
  return 'none';
}

// Singleton — built once at startup after dotenv has loaded
export const appConfig: AppConfig = buildConfigFromEnv();
export type { AppConfig };
