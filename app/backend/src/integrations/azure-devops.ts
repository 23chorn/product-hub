import axios, { AxiosInstance } from 'axios';
import Logger from '../utils/logger';
import { BacklogStructure } from '@pap/shared';

const logger = new Logger('AZURE-DEVOPS');

/** Round a number to the nearest value in the Fibonacci sequence (1–144). */
function toNearestFibonacci(n: number): number {
  const fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  if (n <= 0) return 1;
  return fibs.reduce((prev, curr) => (Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev));
}

/** Strip leading user-story prefixes that the model may have included in the JSON fields. */
function stripStoryPrefix(text: string, prefix: RegExp): string {
  return text.replace(prefix, '').trim();
}

/** Escape special HTML characters to prevent injection in ADO rich-text fields */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a Given/When/Then acceptance criterion string into HTML with
 * each keyword on a new line and bolded.
 * Input:  "Given X When Y Then Z"
 * Output: "<b>Given</b> X<br><b>When</b> Y<br><b>Then</b> Z"
 */
function formatGivenWhenThen(text: string): string {
  // Split on Given/When/Then/And keywords (case-insensitive, word boundary)
  // while preserving the keyword itself
  return text
    .replace(/\b(Given|When|Then|And|But)\b/gi, '\n$1')
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => line.trim().replace(/^(Given|When|Then|And|But)\b/i, '<b>$1</b>'))
    .join('<br>');
}

/**
 * Format the `technical` block from a backlog story into an HTML section.
 * Framed as suggestions because the architect's output is AI-generated and
 * must be validated by the engineering team before implementation.
 * Returns an empty string when no meaningful technical data is present.
 */
function buildTechnicalSuggestions(technical: { constraints?: string[]; affectedComponents?: string[]; dataChanges?: string | null; apiChanges?: string | null } | undefined): string {
  if (!technical) return '';

  const parts: string[] = [];

  const components = (technical.affectedComponents ?? []).filter(Boolean);
  if (components.length) {
    parts.push(`<b>Affected Components:</b> ${escapeHtml(components.join(', '))}`);
  }

  const constraints = (technical.constraints ?? []).filter(Boolean);
  if (constraints.length) {
    parts.push(`<b>Constraints:</b><ul>${constraints.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`);
  }

  if (technical.dataChanges && technical.dataChanges !== 'null') {
    parts.push(`<b>Data Changes:</b> ${escapeHtml(technical.dataChanges)}`);
  }

  if (technical.apiChanges && technical.apiChanges !== 'null') {
    parts.push(`<b>API Changes:</b> ${escapeHtml(technical.apiChanges)}`);
  }

  if (!parts.length) return '';

  return [
    '<hr>',
    '<b>Technical Suggestions</b> <i>(AI-generated · pending engineering review)</i><br>',
    parts.join('<br>'),
  ].join('');
}

export interface WorkItem {
  id?: number;
  fields: {
    'System.Title': string;
    'System.Description'?: string;
    'System.WorkItemType': 'Epic' | 'Feature' | 'User Story' | 'Task';
    'System.State'?: string;
    'System.AreaPath'?: string;
    'System.IterationPath'?: string;
    'Microsoft.VSTS.Common.Priority'?: number;
    'Microsoft.VSTS.Scheduling.Effort'?: number;
    [key: string]: any;
  };
}

export interface CreateWorkItemRequest {
  type: 'Epic' | 'Feature' | 'User Story' | 'Task';
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  parentId?: number;
  areaPath?: string;
  iterationPath?: string;
  priority?: number;
  effort?: number;
  aiEstimateDevHours?: number;
  aiEstimateQaHours?: number;
}

/**
 * Azure DevOps API client for work item management
 */
export class AzureDevOpsClient {
  private client: AxiosInstance;
  private organization: string;
  private project: string;
  private pat: string;
  private workItemTypes: {
    epic: string;
    feature: string;
    story: string;
    task: string;
  };
  private customFields: {
    aiEstimateDev: string;
    aiEstimateQa: string;
  };

  constructor() {
    // Parse organization from env variable
    // Support both formats: just org name "xCubeApp" or full URL "https://dev.azure.com/xCubeApp"
    let orgValue = process.env.AZURE_DEVOPS_ORG || '';
    if (orgValue.includes('dev.azure.com')) {
      // Extract org name from URL
      const match = orgValue.match(/dev\.azure\.com\/([^\/]+)/);
      if (match) {
        this.organization = match[1];
      } else {
        this.organization = orgValue;
      }
    } else {
      this.organization = orgValue;
    }

    this.project = process.env.AZURE_DEVOPS_PROJECT || '';
    this.pat = process.env.AZURE_DEVOPS_PAT || '';

    // Configure work item types based on process template
    // Defaults are for Agile, but can be customized via env variables
    this.workItemTypes = {
      epic: process.env.AZURE_DEVOPS_EPIC_TYPE || 'Epic',
      feature: process.env.AZURE_DEVOPS_FEATURE_TYPE || 'Feature',
      story: process.env.AZURE_DEVOPS_STORY_TYPE || 'User Story',
      task: process.env.AZURE_DEVOPS_TASK_TYPE || 'Task',
    };

    if (!this.organization || !this.project || !this.pat) {
      logger.warn(
        'Azure DevOps not fully configured. Set AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT environment variables.'
      );
    }

    this.customFields = {
      aiEstimateDev: process.env.AZURE_DEVOPS_AI_EST_DEV_FIELD || 'Custom.AIEstimateDev',
      aiEstimateQa: process.env.AZURE_DEVOPS_AI_EST_QA_FIELD || 'Custom.AIEstimateQA',
    };

    logger.info(`Work item types configured: Epic=${this.workItemTypes.epic}, Feature=${this.workItemTypes.feature}, Story=${this.workItemTypes.story}, Task=${this.workItemTypes.task}`);
    logger.info(`Custom fields: aiEstimateDev=${this.customFields.aiEstimateDev}, aiEstimateQa=${this.customFields.aiEstimateQa}`);

    // Create axios instance with Azure DevOps API configuration
    this.client = axios.create({
      baseURL: `https://dev.azure.com/${this.organization}/${this.project}/_apis`,
      headers: {
        'Content-Type': 'application/json-patch+json',
        Authorization: `Basic ${Buffer.from(`:${this.pat}`).toString('base64')}`,
      },
      params: {
        'api-version': '7.1',
      },
    });

    logger.info(
      `Azure DevOps configured: ${this.organization}/${this.project}`
    );
  }

  /**
   * Create a single work item
   */
  async createWorkItem(request: CreateWorkItemRequest): Promise<WorkItem> {
    logger.info(`Creating ${request.type}: ${request.title}`);

    const operations: any[] = [
      {
        op: 'add',
        path: '/fields/System.Title',
        value: request.title,
      },
    ];

    if (request.description) {
      operations.push({
        op: 'add',
        path: '/fields/System.Description',
        value: request.description,
      });
    }

    if (request.areaPath) {
      operations.push({
        op: 'add',
        path: '/fields/System.AreaPath',
        value: request.areaPath,
      });
    }

    if (request.iterationPath) {
      operations.push({
        op: 'add',
        path: '/fields/System.IterationPath',
        value: request.iterationPath,
      });
    }

    if (request.priority !== undefined) {
      operations.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: request.priority,
      });
    }

    if (request.effort !== undefined) {
      operations.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Scheduling.Effort',
        value: request.effort,
      });
    }

    if (request.aiEstimateDevHours !== undefined) {
      operations.push({
        op: 'add',
        path: `/fields/${this.customFields.aiEstimateDev}`,
        value: request.aiEstimateDevHours,
      });
    }

    if (request.aiEstimateQaHours !== undefined) {
      operations.push({
        op: 'add',
        path: `/fields/${this.customFields.aiEstimateQa}`,
        value: request.aiEstimateQaHours,
      });
    }

    if (request.acceptanceCriteria) {
      operations.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
        value: request.acceptanceCriteria,
      });
    }

    // Add parent link if specified
    if (request.parentId) {
      operations.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workItems/${request.parentId}`,
        },
      });
    }

    try {
      // Azure DevOps API format: /wit/workitems/$Epic or /wit/workitems/$User Story
      // The space in "User Story" will be automatically URL-encoded by axios
      const response = await this.client.post(
        `/wit/workitems/$${request.type}`,
        operations
      );

      logger.info(
        `Created ${request.type} #${response.data.id}: ${request.title}`
      );
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to create ${request.type}`, error);
      // Log more details for debugging
      if (error.response) {
        logger.error('Response status:', error.response.status);
        logger.error('Response data:', JSON.stringify(error.response.data));
        logger.error('Request URL:', error.config?.url);
      }
      throw new Error(
        `Azure DevOps API error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Create entire backlog structure from a backlog plan.
   * MVP features go under the main epic.
   * Phase 2 / Post-launch features are grouped by phase and each phase gets its own epic.
   */
  async createBacklog(structure: BacklogStructure): Promise<{
    epicId: number;
    extraEpicIds: number[];
    featureIds: number[];
    storyIds: number[];
    taskIds: number[];
  }> {
    logger.info(`Creating backlog structure: ${structure.epic.title}`);

    const featureIds: number[] = [];
    const storyIds: number[] = [];
    const taskIds: number[] = [];
    const extraEpicIds: number[] = [];

    /** Create ADO features + stories under a given parent epic ID */
    const createFeaturesUnderEpic = async (features: BacklogStructure['features'], parentId: number) => {
      for (const featureData of features) {
        const feature = await this.createWorkItem({
          type: this.workItemTypes.feature as any,
          title: featureData.title,
          description: featureData.description,
          parentId,
        });
        featureIds.push(feature.id!);

        for (const storyData of featureData.stories) {
          const storyDescription = [
            `<b>As a</b> ${escapeHtml(stripStoryPrefix(storyData.persona, /^as an?\s+/i))}`,
            `<b>I want</b> ${escapeHtml(stripStoryPrefix(storyData.goal, /^i want\s+(to\s+)?/i))}`,
            `<b>So that</b> ${escapeHtml(stripStoryPrefix(storyData.benefit, /^so that\s+/i))}`,
          ].join('<br>') + buildTechnicalSuggestions(storyData.technical);

          let acceptanceCriteriaHtml: string | undefined;
          if (storyData.acceptanceCriteria && storyData.acceptanceCriteria.length > 0) {
            acceptanceCriteriaHtml = storyData.acceptanceCriteria
              .map((ac, i) => {
                const formatted = formatGivenWhenThen(escapeHtml(ac));
                return `<b>AC ${i + 1}</b><br>${formatted}`;
              })
              .join('<br><br>');
          }

          const story = await this.createWorkItem({
            type: this.workItemTypes.story as any,
            title: storyData.title,
            description: storyDescription,
            acceptanceCriteria: acceptanceCriteriaHtml,
            effort: storyData.effort,
            aiEstimateDevHours: storyData.aiEstimatedHours !== undefined ? toNearestFibonacci(storyData.aiEstimatedHours) : undefined,
            aiEstimateQaHours: storyData.aiEstimatedQaHours,
            parentId: feature.id,
          });
          storyIds.push(story.id!);
        }
      }
    };

    try {
      // Split features by phase
      const mvpFeatures = structure.features.filter(f => f.phase?.toLowerCase() === 'mvp');
      const laterPhases = new Map<string, typeof structure.features>();
      for (const f of structure.features) {
        if (f.phase?.toLowerCase() !== 'mvp') {
          const key = f.phase || 'Phase 2';
          if (!laterPhases.has(key)) laterPhases.set(key, []);
          laterPhases.get(key)!.push(f);
        }
      }

      // If there are no MVP features, skip the phase split — everything goes under one epic
      const splitByPhase = mvpFeatures.length > 0 && laterPhases.size > 0;

      // Total story-point effort across all features for high-level prioritisation
      const totalEffort = structure.features
        .flatMap(f => f.stories)
        .reduce((sum, s) => sum + (s.effort ?? 0), 0);

      // 1. Main epic — MVP features only (or all features if not splitting)
      const epic = await this.createWorkItem({
        type: this.workItemTypes.epic as any,
        title: structure.epic.title,
        description: structure.epic.description,
        effort: totalEffort || undefined,
      });
      await createFeaturesUnderEpic(splitByPhase ? mvpFeatures : structure.features, epic.id!);

      // 2. One extra epic per non-MVP phase (only when there's also an MVP epic)
      if (splitByPhase) {
        for (const [phase, features] of laterPhases) {
          const phaseEpic = await this.createWorkItem({
            type: this.workItemTypes.epic as any,
            title: `[${phase}] ${structure.epic.title}`,
            description: `${phase} scope for: ${structure.epic.description}`,
          });
          extraEpicIds.push(phaseEpic.id!);
          await createFeaturesUnderEpic(features, phaseEpic.id!);
          logger.info(`Created ${phase} epic #${phaseEpic.id} with ${features.length} feature(s)`);
        }
      }

      logger.info(
        `Created backlog: Epic #${epic.id}${extraEpicIds.length ? ` + ${extraEpicIds.length} phase epic(s)` : ''}, ${featureIds.length} features, ${storyIds.length} stories`
      );

      return { epicId: epic.id!, extraEpicIds, featureIds, storyIds, taskIds };
    } catch (error: any) {
      logger.error('Failed to create backlog structure', error);
      throw error;
    }
  }

  /**
   * Update an existing work item.
   * Only patches the fields that are provided (non-undefined).
   */
  async updateWorkItem(
    id: number,
    updates: { title?: string; description?: string; effort?: number; acceptanceCriteria?: string; aiEstimateDevHours?: number; aiEstimateQaHours?: number }
  ): Promise<WorkItem> {
    logger.info(`Updating work item #${id}`);

    const operations: any[] = [];

    if (updates.title !== undefined) {
      operations.push({ op: 'replace', path: '/fields/System.Title', value: updates.title });
    }
    if (updates.description !== undefined) {
      operations.push({ op: 'replace', path: '/fields/System.Description', value: updates.description });
    }
    if (updates.effort !== undefined) {
      operations.push({ op: 'replace', path: '/fields/Microsoft.VSTS.Scheduling.Effort', value: updates.effort });
    }
    if (updates.acceptanceCriteria !== undefined) {
      operations.push({ op: 'replace', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: updates.acceptanceCriteria });
    }
    if (updates.aiEstimateDevHours !== undefined) {
      operations.push({ op: 'add', path: `/fields/${this.customFields.aiEstimateDev}`, value: updates.aiEstimateDevHours });
    }
    if (updates.aiEstimateQaHours !== undefined) {
      operations.push({ op: 'add', path: `/fields/${this.customFields.aiEstimateQa}`, value: updates.aiEstimateQaHours });
    }

    if (operations.length === 0) {
      logger.info(`No updates for work item #${id} — skipping`);
      return this.getWorkItem(id);
    }

    try {
      const response = await this.client.patch(`/wit/workitems/${id}`, operations);
      logger.info(`Updated work item #${id}: ${Object.keys(updates).filter(k => (updates as any)[k] !== undefined).join(', ')}`);
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to update work item #${id}`, error);
      throw new Error(
        `Azure DevOps API error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Update an existing backlog structure using a local_key → ado_id map.
   * Updates changed items, creates new ones, returns counts.
   */
  async updateBacklog(
    structure: BacklogStructure,
    existingMap: Map<string, { ado_id: number; title: string }>
  ): Promise<{
    epicId: number;
    created: number;
    updated: number;
    newMappings: Array<{ local_key: string; ado_id: number; ado_type: string; title: string; ado_url: string }>;
  }> {
    let created = 0;
    let updated = 0;
    const newMappings: Array<{ local_key: string; ado_id: number; ado_type: string; title: string; ado_url: string }> = [];

    const epicMapping = existingMap.get('epic');
    if (!epicMapping) {
      throw new Error('No existing epic mapping found — cannot update');
    }

    const epicId = epicMapping.ado_id;

    // Always sync epic description and total effort; count as updated only when title changes
    const epicTitleChanged = epicMapping.title !== structure.epic.title;
    const epicTotalEffort = structure.features
      .flatMap(f => f.stories)
      .reduce((sum, s) => sum + (s.effort ?? 0), 0);
    await this.updateWorkItem(epicId, {
      ...(epicTitleChanged ? { title: structure.epic.title } : {}),
      description: structure.epic.description,
      effort: epicTotalEffort || undefined,
    });
    if (epicTitleChanged) updated++;

    // Process features and stories
    for (let fi = 0; fi < structure.features.length; fi++) {
      const featureData = structure.features[fi];
      const featureKey = `F${fi + 1}`;
      const featureMapping = existingMap.get(featureKey);

      let featureAdoId: number;
      if (featureMapping) {
        // Always sync feature description (carries PRD enrichment); count as updated only when title changes
        const featureTitleChanged = featureMapping.title !== featureData.title;
        await this.updateWorkItem(featureMapping.ado_id, {
          ...(featureTitleChanged ? { title: featureData.title } : {}),
          description: featureData.description,
        });
        if (featureTitleChanged) updated++;
        featureAdoId = featureMapping.ado_id;
      } else {
        // Create new feature
        const feature = await this.createWorkItem({
          type: this.workItemTypes.feature as any,
          title: featureData.title,
          description: featureData.description,
          parentId: epicId,
        });
        featureAdoId = feature.id!;
        created++;
        newMappings.push({
          local_key: featureKey,
          ado_id: featureAdoId,
          ado_type: 'feature',
          title: featureData.title,
          ado_url: this.getEpicUrl(featureAdoId),
        });
      }

      // Process stories
      for (let si = 0; si < featureData.stories.length; si++) {
        const storyData = featureData.stories[si];
        const storyKey = `${featureKey}.S${si + 1}`;
        const storyMapping = existingMap.get(storyKey);

        const storyDescription = [
          `<b>As a</b> ${escapeHtml(storyData.persona)}`,
          `<b>I want</b> ${escapeHtml(storyData.goal)}`,
          `<b>So that</b> ${escapeHtml(storyData.benefit)}`,
        ].join('<br>') + buildTechnicalSuggestions(storyData.technical);

        let acceptanceCriteriaHtml: string | undefined;
        if (storyData.acceptanceCriteria && storyData.acceptanceCriteria.length > 0) {
          acceptanceCriteriaHtml = storyData.acceptanceCriteria
            .map((ac, i) => {
              const formatted = formatGivenWhenThen(escapeHtml(ac));
              return `<b>AC ${i + 1}</b><br>${formatted}`;
            })
            .join('<br><br>');
        }

        if (storyMapping) {
          const rawAiHours = storyData.aiEstimatedHours;
          const fibAiHours = rawAiHours !== undefined && rawAiHours !== null ? toNearestFibonacci(rawAiHours) : undefined;
          logger.info(`Story "${storyData.title}" (#${storyMapping.ado_id}): aiEstimatedHours=${rawAiHours} → fibonacciValue=${fibAiHours}`);
          await this.updateWorkItem(storyMapping.ado_id, {
            title: storyData.title,
            description: storyDescription,
            acceptanceCriteria: acceptanceCriteriaHtml,
            aiEstimateDevHours: fibAiHours,
            aiEstimateQaHours: storyData.aiEstimatedQaHours,
          });
          updated++;
        } else {
          // Create new story
          const rawAiHours = storyData.aiEstimatedHours;
          const fibAiHours = rawAiHours !== undefined && rawAiHours !== null ? toNearestFibonacci(rawAiHours) : undefined;
          const story = await this.createWorkItem({
            type: this.workItemTypes.story as any,
            title: storyData.title,
            description: storyDescription,
            acceptanceCriteria: acceptanceCriteriaHtml,
            effort: storyData.effort,
            aiEstimateDevHours: fibAiHours,
            aiEstimateQaHours: storyData.aiEstimatedQaHours,
            parentId: featureAdoId,
          });
          created++;
          newMappings.push({
            local_key: storyKey,
            ado_id: story.id!,
            ado_type: 'story',
            title: storyData.title,
            ado_url: this.getEpicUrl(story.id!),
          });
        }
      }
    }

    logger.info(`Updated backlog: ${updated} updated, ${created} created`);
    return { epicId, created, updated, newMappings };
  }

  /**
   * Add a comment (discussion) to a work item via the System.History field.
   */
  async addComment(id: number, html: string): Promise<void> {
    logger.info(`Adding comment to work item #${id}`);
    try {
      await this.client.patch(`/wit/workitems/${id}`, [
        { op: 'add', path: '/fields/System.History', value: html },
      ]);
    } catch (error: any) {
      logger.error(`Failed to add comment to work item #${id}`, error);
      throw new Error(`Azure DevOps API error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get work item by ID
   */
  async getWorkItem(id: number): Promise<WorkItem> {
    try {
      const response = await this.client.get(`/wit/workitems/${id}`);
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to get work item ${id}`, error);
      throw new Error(
        `Azure DevOps API error: ${error.response?.data?.message || error.message}`
      );
    }
  }

  /**
   * Get Epic URL for browser
   */
  getEpicUrl(epicId: number): string {
    return `https://dev.azure.com/${this.organization}/${this.project}/_workitems/edit/${epicId}`;
  }
}
