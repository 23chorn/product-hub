import axios, { AxiosInstance } from 'axios';
import Logger from '../utils/logger';
import { BacklogStructure, featureLocalKey, storyLocalKey } from '@pap/shared';
import {
  adoErrorMessage,
  deriveAiEstimateDev,
  buildStoryDescriptionHtml,
  buildAcceptanceCriteriaHtml,
  deriveTeamTags,
  deriveEpicLocalKey,
  type StoryHtmlInput,
} from './azure-devops-format';
import {
  pushQATestPlan as pushQATestPlanImpl,
  deleteTestPlan as deleteTestPlanImpl,
  deleteTestCase as deleteTestCaseImpl,
  type TestPlanContext,
} from './azure-devops-test-plans';
import {
  listRepositories as listRepositoriesImpl,
  listMarkdownFiles as listMarkdownFilesImpl,
  getFileContent as getFileContentImpl,
  getFileContentAtCommit as getFileContentAtCommitImpl,
  listFileCommits as listFileCommitsImpl,
  type GitContext,
} from './azure-devops-git';

const logger = new Logger('AZURE-DEVOPS');

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

/**
 * Story shape accepted by createStoriesUnderFeature — structurally satisfied by
 * BacklogStructure stories and by addFeatureToEpic's inline story payloads.
 */
type BacklogStoryInput = StoryHtmlInput & {
  title: string;
  acceptanceCriteria?: string[];
  effort?: number;
  aiEstimatedQaHours?: number;
};

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
  tags?: string;
}

/**
 * Azure DevOps API client for work item management
 */
export class AzureDevOpsClient {
  private client: AxiosInstance;
  private organization: string;
  private project: string;
  private pat: string;
  readonly wikiIdentifier: string;
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
    // Default wiki identifier: sanitize project name to avoid colons/special chars that ASP.NET blocks in URL paths
    const sanitizedProject = this.project.replace(/[^a-zA-Z0-9-_]/g, '-');
    let wikiIdValue = process.env.AZURE_DEVOPS_WIKI_ID || `${sanitizedProject}.wiki`;
    // If AZURE_DEVOPS_WIKI_ID is a full URL, extract just the identifier
    if (wikiIdValue.includes('_wiki/wikis/')) {
      const match = wikiIdValue.match(/_wiki\/wikis\/([^\/]+)/);
      if (match) {
        wikiIdValue = match[1];
        logger.info(`Extracted wiki identifier from URL: ${wikiIdValue}`);
      }
    }
    this.wikiIdentifier = wikiIdValue;

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

  // Typed wrappers that fill in the configured (process-template-specific) work item
  // type, so callers don't need to reach into workItemTypes and cast.
  async createEpic(request: Omit<CreateWorkItemRequest, 'type'>): Promise<WorkItem> {
    return this.createWorkItem({ ...request, type: this.workItemTypes.epic as CreateWorkItemRequest['type'] });
  }

  async createFeature(request: Omit<CreateWorkItemRequest, 'type'>): Promise<WorkItem> {
    return this.createWorkItem({ ...request, type: this.workItemTypes.feature as CreateWorkItemRequest['type'] });
  }

  async createStory(request: Omit<CreateWorkItemRequest, 'type'>): Promise<WorkItem> {
    return this.createWorkItem({ ...request, type: this.workItemTypes.story as CreateWorkItemRequest['type'] });
  }

  /**
   * Create story work items under a feature. Shared by createBacklog and
   * addFeatureToEpic — one source of truth for the description/AC HTML and
   * estimate/tag derivation. Returns the created story IDs in input order.
   */
  private async createStoriesUnderFeature(featureId: number, stories: BacklogStoryInput[]): Promise<number[]> {
    const storyIds: number[] = [];
    for (const storyData of stories) {
      const story = await this.createWorkItem({
        type: this.workItemTypes.story as any,
        title: storyData.title,
        description: buildStoryDescriptionHtml(storyData),
        acceptanceCriteria: buildAcceptanceCriteriaHtml(storyData.acceptanceCriteria),
        effort: storyData.effort,
        aiEstimateDevHours: deriveAiEstimateDev(storyData.effort),
        aiEstimateQaHours: storyData.aiEstimatedQaHours,
        tags: deriveTeamTags(storyData.technical_notes),
        parentId: featureId,
      });
      storyIds.push(story.id!);
    }
    return storyIds;
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

    if (request.tags) {
      operations.push({
        op: 'add',
        path: '/fields/System.Tags',
        value: request.tags,
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
        `Azure DevOps API error: ${adoErrorMessage(error)}`
      );
    }
  }

  /**
   * Create entire backlog structure from a backlog plan.
   * MVP features go under the main epic.
   * Phase 2 / Post-launch features are grouped by phase and each phase gets its own epic.
   */
  async createBacklog(structure: BacklogStructure): Promise<{
    epics: Array<{ localKey: string; adoId: number; title: string }>;
    features: Array<{ index: number; adoId: number; epicLocalKey: string; storyAdoIds: number[] }>;
  }> {
    logger.info(`Creating backlog structure: ${structure.epic.title}`);

    type IndexedFeature = { index: number; data: BacklogStructure['features'][number] };
    const epics: Array<{ localKey: string; adoId: number; title: string }> = [];
    const features: Array<{ index: number; adoId: number; epicLocalKey: string; storyAdoIds: number[] }> = [];

    /** Create ADO features + stories under a given parent epic, recording each feature's
     *  original structure.features index (not creation order) and the epic it landed under —
     *  the caller needs both to correctly re-associate ADO ids back to local F#/S# keys. */
    const createFeaturesUnderEpic = async (indexed: IndexedFeature[], parentId: number, epicLocalKey: string) => {
      for (const { index, data: featureData } of indexed) {
        const feature = await this.createWorkItem({
          type: this.workItemTypes.feature as any,
          title: featureData.title,
          description: featureData.description,
          parentId,
        });
        const storyAdoIds = await this.createStoriesUnderFeature(feature.id!, featureData.stories);
        features.push({ index, adoId: feature.id!, epicLocalKey, storyAdoIds });
      }
    };

    try {
      // Split features by phase, keyed by the same epicLocalKey pushTestPlanToAdo will later
      // use to route test cases — so epic creation and test-plan routing never disagree.
      const indexedFeatures: IndexedFeature[] = structure.features.map((data, index) => ({ index, data }));
      const mvpFeatures = indexedFeatures.filter(f => deriveEpicLocalKey(f.data.phase) === 'epic');
      const laterPhases = new Map<string, { label: string; features: IndexedFeature[] }>();
      for (const f of indexedFeatures) {
        const epicLocalKey = deriveEpicLocalKey(f.data.phase);
        if (epicLocalKey === 'epic') continue;
        if (!laterPhases.has(epicLocalKey)) laterPhases.set(epicLocalKey, { label: f.data.phase || 'Phase 2', features: [] });
        laterPhases.get(epicLocalKey)!.features.push(f);
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
      epics.push({ localKey: 'epic', adoId: epic.id!, title: structure.epic.title });
      await createFeaturesUnderEpic(splitByPhase ? mvpFeatures : indexedFeatures, epic.id!, 'epic');

      // 2. One extra epic per non-MVP phase (only when there's also an MVP epic)
      if (splitByPhase) {
        for (const [epicLocalKey, { label, features: phaseFeatures }] of laterPhases) {
          const phaseTitle = `[${label}] ${structure.epic.title}`;
          const phaseEpic = await this.createWorkItem({
            type: this.workItemTypes.epic as any,
            title: phaseTitle,
            description: `${label} scope for: ${structure.epic.description}`,
          });
          epics.push({ localKey: epicLocalKey, adoId: phaseEpic.id!, title: phaseTitle });
          await createFeaturesUnderEpic(phaseFeatures, phaseEpic.id!, epicLocalKey);
          logger.info(`Created ${label} epic #${phaseEpic.id} with ${phaseFeatures.length} feature(s)`);
        }
      }

      logger.info(
        `Created backlog: Epic #${epic.id}${epics.length > 1 ? ` + ${epics.length - 1} phase epic(s)` : ''}, ${features.length} features, ${features.reduce((n, f) => n + f.storyAdoIds.length, 0)} stories`
      );

      return { epics, features };
    } catch (error: any) {
      logger.error('Failed to create backlog structure', error);
      throw error;
    }
  }

  /**
   * Add a single feature (with its stories) to an existing epic.
   * Used for incremental feature-by-feature story decomposition.
   *
   * @param epicId - The parent epic ID
   * @param feature - The feature data to add
   * @returns Created feature and story IDs
   */
  async addFeatureToEpic(
    epicId: number,
    feature: {
      title: string;
      description: string;
      phase?: string;
      stories: Array<{
        title: string;
        persona: string;
        goal: string;
        benefit: string;
        acceptanceCriteria?: string[];
        effort?: number;
        technical?: any;
        technical_notes?: any;
        aiEstimatedHours?: number;
        aiEstimatedQaHours?: number;
      }>;
    }
  ): Promise<{ featureId: number; storyIds: number[] }> {
    logger.info(`Adding feature "${feature.title}" to epic #${epicId}`);

    try {
      // Create the feature under the epic
      const createdFeature = await this.createWorkItem({
        type: this.workItemTypes.feature as any,
        title: feature.title,
        description: feature.description,
        parentId: epicId,
      });
      logger.info(`Created feature #${createdFeature.id!}: ${feature.title}`);

      const storyIds = await this.createStoriesUnderFeature(createdFeature.id!, feature.stories);

      logger.info(`Added feature #${createdFeature.id!} with ${storyIds.length} stories to epic #${epicId}`);
      return { featureId: createdFeature.id!, storyIds };
    } catch (error: any) {
      logger.error(`Failed to add feature to epic #${epicId}`, error);
      throw new Error(
        `Azure DevOps API error: ${adoErrorMessage(error)}`
      );
    }
  }

  /**
   * Update an existing work item.
   * Only patches the fields that are provided (non-undefined).
   */
  async updateWorkItem(
    id: number,
    updates: { title?: string; description?: string; effort?: number; acceptanceCriteria?: string; aiEstimateDevHours?: number; aiEstimateQaHours?: number; tags?: string; state?: string }
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
    if (updates.tags !== undefined) {
      operations.push({ op: 'replace', path: '/fields/System.Tags', value: updates.tags });
    }
    if (updates.state !== undefined) {
      operations.push({ op: 'replace', path: '/fields/System.State', value: updates.state });
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
        `Azure DevOps API error: ${adoErrorMessage(error)}`
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
    newMappings: Array<{ local_key: string; ado_id: number; ado_type: string; title: string; ado_url: string; parent_local_key: string | null }>;
  }> {
    let created = 0;
    let updated = 0;
    const newMappings: Array<{ local_key: string; ado_id: number; ado_type: string; title: string; ado_url: string; parent_local_key: string | null }> = [];

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

    // Resolve (or lazily create) the phase Epic a new feature belongs to — needed when a later
    // phase (e.g. "Phase 2") is added incrementally to a backlog that was first pushed with only
    // MVP features, so its epic doesn't exist in existingMap yet. Epics created earlier in this
    // same call are cached here so later features in the same phase reuse them.
    const resolvedPhaseEpicIds = new Map<string, number>([['epic', epicId]]);
    const resolvePhaseEpicId = async (phase: string): Promise<number> => {
      const epicLocalKey = deriveEpicLocalKey(phase);
      if (resolvedPhaseEpicIds.has(epicLocalKey)) return resolvedPhaseEpicIds.get(epicLocalKey)!;
      const existing = existingMap.get(epicLocalKey);
      if (existing) {
        resolvedPhaseEpicIds.set(epicLocalKey, existing.ado_id);
        return existing.ado_id;
      }
      const label = phase || 'Phase 2';
      const phaseTitle = `[${label}] ${structure.epic.title}`;
      const phaseEpic = await this.createWorkItem({
        type: this.workItemTypes.epic as any,
        title: phaseTitle,
        description: `${label} scope for: ${structure.epic.description}`,
      });
      resolvedPhaseEpicIds.set(epicLocalKey, phaseEpic.id!);
      newMappings.push({
        local_key: epicLocalKey,
        ado_id: phaseEpic.id!,
        ado_type: 'epic',
        title: phaseTitle,
        ado_url: this.getEpicUrl(phaseEpic.id!),
        parent_local_key: null,
      });
      logger.info(`Created ${label} epic #${phaseEpic.id} for incremental backlog update`);
      return phaseEpic.id!;
    };

    // Process features and stories
    for (let fi = 0; fi < structure.features.length; fi++) {
      const featureData = structure.features[fi];
      const featureKey = featureLocalKey(fi);
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
        // Create new feature under the epic for its phase (creating that phase's epic on
        // first use if a later phase is being added to an already-pushed backlog).
        const epicLocalKey = deriveEpicLocalKey(featureData.phase);
        const parentEpicId = await resolvePhaseEpicId(featureData.phase);
        const feature = await this.createWorkItem({
          type: this.workItemTypes.feature as any,
          title: featureData.title,
          description: featureData.description,
          parentId: parentEpicId,
        });
        featureAdoId = feature.id!;
        created++;
        newMappings.push({
          local_key: featureKey,
          ado_id: featureAdoId,
          ado_type: 'feature',
          title: featureData.title,
          ado_url: this.getEpicUrl(featureAdoId),
          parent_local_key: epicLocalKey,
        });
      }

      // Process stories
      for (let si = 0; si < featureData.stories.length; si++) {
        const storyData = featureData.stories[si];
        const storyKey = storyLocalKey(featureKey, si);
        const storyMapping = existingMap.get(storyKey);

        // Shared builders strip duplicated "As a…"/"I want…" prefixes — previously this
        // update path lacked the strip its create-path siblings had (copy drift).
        const storyDescription = buildStoryDescriptionHtml(storyData);
        const acceptanceCriteriaHtml = buildAcceptanceCriteriaHtml(storyData.acceptanceCriteria);

        if (storyMapping) {
          await this.updateWorkItem(storyMapping.ado_id, {
            title: storyData.title,
            description: storyDescription,
            acceptanceCriteria: acceptanceCriteriaHtml,
            aiEstimateDevHours: deriveAiEstimateDev(storyData.effort),
            aiEstimateQaHours: storyData.aiEstimatedQaHours,
            tags: deriveTeamTags(storyData.technical_notes),
          });
          updated++;
        } else {
          // Create new story
          const story = await this.createWorkItem({
            type: this.workItemTypes.story as any,
            title: storyData.title,
            description: storyDescription,
            acceptanceCriteria: acceptanceCriteriaHtml,
            effort: storyData.effort,
            aiEstimateDevHours: deriveAiEstimateDev(storyData.effort),
            aiEstimateQaHours: storyData.aiEstimatedQaHours,
            tags: deriveTeamTags(storyData.technical_notes),
            parentId: featureAdoId,
          });
          created++;
          newMappings.push({
            local_key: storyKey,
            ado_id: story.id!,
            ado_type: 'story',
            title: storyData.title,
            ado_url: this.getEpicUrl(story.id!),
            parent_local_key: featureKey,
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
      throw new Error(`Azure DevOps API error: ${adoErrorMessage(error)}`);
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
        `Azure DevOps API error: ${adoErrorMessage(error)}`
      );
    }
  }

  /**
   * Fetch a work item and the IDs of its direct children (Hierarchy-Forward relations).
   * Used by the ADO sync endpoint to walk epic → features → stories.
   */
  async getWorkItemWithChildren(id: number): Promise<{ item: WorkItem; childIds: number[] }> {
    try {
      const response = await this.client.get(`/wit/workitems/${id}?$expand=relations`);
      const item = response.data as WorkItem & { relations?: Array<{ rel: string; url: string }> };
      const childIds = (item.relations ?? [])
        .filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward')
        .map(r => { const m = /\/(\d+)$/.exec(r.url); return m ? parseInt(m[1], 10) : null; })
        .filter((cid): cid is number => cid !== null);
      return { item, childIds };
    } catch (error: any) {
      logger.error(`Failed to get work item ${id} with children`, error);
      throw new Error(`Azure DevOps API error: ${adoErrorMessage(error)}`);
    }
  }

  /**
   * Batch-fetch work items by id (ADO caps a single batch at 200 ids — chunk and
   * concatenate). Used by the Completed Initiatives "Refresh" action to pull current
   * `System.State` for every work item on an initiative in as few round trips as possible.
   */
  async getWorkItemsBatch(ids: number[], fields?: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];

    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

    const results: WorkItem[] = [];
    for (const chunk of chunks) {
      try {
        // errorPolicy:'Omit' tells ADO to skip deleted/inaccessible items instead of 404-ing the whole batch
        const response = await this.client.post(
          '/wit/workitemsbatch',
          { ids: chunk, errorPolicy: 'Omit', ...(fields ? { fields } : {}) },
          { headers: { 'Content-Type': 'application/json' } }
        );
        results.push(...response.data.value);
      } catch (error: any) {
        // Batch rejected despite errorPolicy (older ADO versions may not support it).
        // Fall back to individual fetches — skip any that are deleted or inaccessible.
        logger.warn(`Batch fetch failed for ${chunk.length} item(s) — falling back to individual fetches: ${adoErrorMessage(error)}`);
        const settled = await Promise.allSettled(chunk.map(id => this.getWorkItem(id)));
        for (const r of settled) {
          if (r.status === 'fulfilled') results.push(r.value);
        }
      }
    }
    return results;
  }

  /**
   * Sum the effort estimate across a set of work items — stories carry their estimate in the
   * custom AI Estimate Dev field, features/epics carry a previously-written rollup in the
   * standard Effort field, so each item is read from whichever one is populated.
   * Reads live from ADO (not local state) so it reflects manual edits or deletions made
   * directly in ADO, not just through this app.
   */
  async sumEffortFields(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const items = await this.getWorkItemsBatch(ids, [this.customFields.aiEstimateDev, 'Microsoft.VSTS.Scheduling.Effort']);
    return items.reduce((sum, item) => {
      const value = item.fields[this.customFields.aiEstimateDev] ?? item.fields['Microsoft.VSTS.Scheduling.Effort'] ?? 0;
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
  }

  /**
   * Add an external hyperlink relation to a work item.
   * Shows up in the work item's Links tab as "Hyperlink".
   * Safe to call multiple times — ADO deduplicates by URL.
   */
  async addHyperlinkToWorkItem(id: number, url: string, comment: string): Promise<void> {
    try {
      await this.client.patch(`/wit/workitems/${id}`, [
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'Hyperlink',
            url,
            attributes: { comment },
          },
        },
      ]);
      logger.info(`Added hyperlink to work item #${id}: ${url}`);
    } catch (error: any) {
      const msg = adoErrorMessage(error);
      // ADO returns 400 if the hyperlink already exists — treat as success
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        logger.info(`Hyperlink already present on work item #${id} — skipping`);
        return;
      }
      logger.error(`Failed to add hyperlink to work item #${id}: ${msg}`);
      throw new Error(`Azure DevOps API error: ${msg}`);
    }
  }

  /**
   * Browser edit URL for any work item (epic, feature, story, task).
   */
  getWorkItemUrl(id: number): string {
    return `https://dev.azure.com/${this.organization}/${this.project}/_workitems/edit/${id}`;
  }

  /** Historical alias for getWorkItemUrl — it was never epic-specific. Prefer getWorkItemUrl in new code. */
  getEpicUrl(epicId: number): string {
    return this.getWorkItemUrl(epicId);
  }

  /**
   * Get the URL for a wiki page in the browser.
   * wikiIdentifier is the wiki name slug (e.g. "xCube-Backend.wiki").
   * path is the page path (e.g. "/Product Documentation/Features/My Feature").
   */
  getWikiPageUrl(wikiIdentifier: string, path: string): string {
    const encoded = encodeURIComponent(path.replace(/^\//, ''));
    return `https://dev.azure.com/${this.organization}/${this.project}/_wiki/wikis/${wikiIdentifier}?pagePath=${encoded}`;
  }

  /**
   * Create or update a wiki page.
   * Returns the ETag of the page (needed for updates).
   */
  // Encode a wiki page path for use in the ADO API query string.
  // Each segment is individually encoded (spaces → %20, parens → %28/%29 etc.)
  // but segment separators (/) are kept literal, as ADO expects.
  private wikiPathParam(path: string): string {
    return path.split('/').map(s => encodeURIComponent(s)).join('/');
  }

  private wikiUrl(wikiIdentifier: string, path: string): string {
    // Double-encode the identifier to prevent axios from decoding %3A back to :
    // ASP.NET blocks colons in URL paths, so %3A must survive the round trip
    const doubleEncoded = encodeURIComponent(encodeURIComponent(wikiIdentifier));
    // api-version is omitted here — the axios instance already adds it via params.
    return `/wiki/wikis/${doubleEncoded}/pages?path=${this.wikiPathParam(path)}`;
  }

  async getWikiPageContent(wikiIdentifier: string, path: string): Promise<string> {
    const apiUrl = this.wikiUrl(wikiIdentifier, path);
    const wikiParams = { 'api-version': '7.1-preview.1', includeContent: true };
    try {
      const response = await this.client.get(apiUrl, {
        headers: { 'Content-Type': 'application/json' },
        params: wikiParams,
      });
      return (response.data as any).content ?? '';
    } catch (error: any) {
      throw new Error(`Wiki page not found: ${path} — ${adoErrorMessage(error)}`);
    }
  }

  async upsertWikiPage(wikiIdentifier: string, path: string, content: string): Promise<{ eTag: string; url: string }> {
    const apiUrl = this.wikiUrl(wikiIdentifier, path);
    // The wiki pages endpoint is preview-only — override the instance default api-version.
    const wikiParams = { 'api-version': '7.1-preview.1' };
    logger.info(`Wiki API URL: ${apiUrl} (wikiId: ${wikiIdentifier})`);

    // GET existing page to retrieve ETag (needed for updates — ADO requires it)
    let currentETag: string | undefined;
    let pageExists = false;
    try {
      const existing = await this.client.get(apiUrl, {
        headers: { 'Content-Type': 'application/json' },
        params: wikiParams,
      });
      currentETag = existing.headers['etag'];
      pageExists = true;
      logger.info(`Existing wiki page found, ETag: ${currentETag}`);
    } catch (err: any) {
      if (err.response?.status === 404) {
        logger.info(`Wiki page does not exist yet, will create new`);
      } else {
        logger.warn(`Failed to check existing wiki page: ${err.response?.status} ${err.message}`);
      }
    }

    try {
      const headers: any = { 'Content-Type': 'application/json' };
      // Only include If-Match if we successfully retrieved an ETag
      if (pageExists && currentETag) {
        headers['If-Match'] = currentETag;
      }

      const response = await this.client.put(
        apiUrl,
        { content },
        {
          headers,
          params: wikiParams,
        }
      );
      const eTag: string = response.headers['etag'] ?? '';
      const pageUrl = this.getWikiPageUrl(wikiIdentifier, path);
      logger.info(`Wiki page upserted: ${path}`);
      return { eTag, url: pageUrl };
    } catch (error: any) {
      logger.error(`Failed to upsert wiki page ${path}`, error?.response?.data ?? error.message);
      throw new Error(`Wiki API error: ${adoErrorMessage(error)}`);
    }
  }

  /**
   * Ensure all parent pages in a path exist (creates empty placeholder pages).
   * For path "/Product Documentation/Features/My Feature", this ensures
   * "/Product Documentation" and "/Product Documentation/Features" exist.
   */
  async ensureWikiPath(wikiIdentifier: string, path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean);
    const wikiParams = { 'api-version': '7.1-preview.1' };
    for (let i = 1; i < segments.length; i++) {
      const ancestorPath = '/' + segments.slice(0, i).join('/');
      const apiUrl = this.wikiUrl(wikiIdentifier, ancestorPath);
      try {
        await this.client.get(apiUrl, {
          headers: { 'Content-Type': 'application/json' },
          params: wikiParams,
        });
        logger.info(`Wiki ancestor path exists: ${ancestorPath}`);
      } catch (getErr: any) {
        if (getErr.response?.status === 404) {
          // Page doesn't exist, create it without If-Match header
          try {
            await this.client.put(
              apiUrl,
              { content: `# ${segments[i - 1]}` },
              { headers: { 'Content-Type': 'application/json' }, params: wikiParams }
            );
            logger.info(`Created wiki ancestor page: ${ancestorPath}`);
          } catch (putErr: any) {
            // Ignore if it was created concurrently or already exists
            if (putErr.response?.status !== 409) {
              logger.warn(`Failed to create wiki ancestor ${ancestorPath}: ${putErr.response?.status}`);
            }
          }
        }
      }
    }
  }

  // ── Test Plans API ────────────────────────────────────────────────────────────

  /** Create a new ADO Test Plan. Returns planId, rootSuiteId, and browser URL. */
  /** Shared primitives the Test Plans API helpers need. */
  private get testPlanContext(): TestPlanContext {
    return { client: this.client, organization: this.organization, project: this.project };
  }

  /**
   * Push or sync a QA test suite to ADO Test Plans.
   * Creates a plan + per-type suites on first push; updates existing test cases and
   * adds new ones on subsequent pushes. Delegates to ./azure-devops-test-plans.
   */
  async pushQATestPlan(params: Parameters<typeof pushQATestPlanImpl>[1]) {
    return pushQATestPlanImpl(this.testPlanContext, params);
  }

  /**
   * Permanently delete a Test Case work item via the Test Management API — the generic
   * work item destroy call rejects Test Case work items outright. Delegates to
   * ./azure-devops-test-plans.
   */
  async deleteTestCase(testCaseId: number): Promise<void> {
    return deleteTestCaseImpl(this.testPlanContext, testCaseId);
  }

  // ── Git Items API (Knowledge Studio) ──────────────────────────────────────────

  /**
   * Shared primitives the Git Items API helpers need. Accepts an optional project
   * override so a Knowledge Studio repo tracked from a different ADO project than
   * the globally configured one (AZURE_DEVOPS_PROJECT) still resolves correctly.
   */
  private gitContext(projectOverride?: string): GitContext {
    return { client: this.client, organization: this.organization, project: projectOverride || this.project };
  }

  /** List every Git repository in the given project (defaults to the configured project). */
  async listAdoRepositories(project?: string) {
    return listRepositoriesImpl(this.gitContext(project));
  }

  /** List every `.md` file in a repository. */
  async listAdoMarkdownFiles(repoName: string, branch?: string, project?: string) {
    return listMarkdownFilesImpl(this.gitContext(project), repoName, branch);
  }

  /** Fetch the raw text content of a single file at the given repo-relative path. */
  async getAdoFileContent(repoName: string, path: string, branch?: string, project?: string) {
    return getFileContentImpl(this.gitContext(project), repoName, path, branch);
  }

  /** Fetch a file's content as it existed at a specific commit. */
  async getAdoFileContentAtCommit(repoName: string, path: string, commitId: string, project?: string) {
    return getFileContentAtCommitImpl(this.gitContext(project), repoName, path, commitId);
  }

  /** List commits that touched a given file path, newest first. */
  async listAdoFileCommits(repoName: string, path: string, branch?: string, project?: string) {
    return listFileCommitsImpl(this.gitContext(project), repoName, path, branch);
  }

  // ── Demo cleanup helpers ──────────────────────────────────────────────────────

  /**
   * Permanently delete a work item (bypasses recycle bin).
   * A 404 (already deleted) is treated as success — the desired end state is already true.
   * Any other failure (permissions, etc.) throws so the caller's local state is never
   * updated to say "deleted" when ADO still has the item.
   */
  async deleteWorkItem(id: number): Promise<void> {
    try {
      await this.client.delete(`/wit/workitems/${id}`, { params: { destroy: true, 'api-version': '7.1' } });
      logger.info(`Deleted work item #${id}`);
    } catch (err: any) {
      if (err.response?.status === 404) return;
      logger.warn(`Failed to delete work item #${id}: ${err.response?.status} ${adoErrorMessage(err)}`);
      throw err;
    }
  }

  /**
   * Delete multiple work items in series (ADO has no batch delete endpoint).
   * Best-effort — a single failure doesn't stop the rest. Returns the ids that were
   * actually confirmed deleted so the caller only clears local state for those.
   */
  async deleteWorkItems(ids: number[]): Promise<number[]> {
    const deleted: number[] = [];
    for (const id of ids) {
      try {
        await this.deleteWorkItem(id);
        deleted.push(id);
      } catch { /* already logged in deleteWorkItem; continue with the rest */ }
    }
    return deleted;
  }

  /** Delete an ADO Test Plan (and all its suites + test cases). Delegates to ./azure-devops-test-plans. */
  async deleteTestPlan(planId: number): Promise<void> {
    return deleteTestPlanImpl(this.testPlanContext, planId);
  }

  /**
   * Delete a wiki page. Silently swallows 404 (already deleted or never created).
   */
  async deleteWikiPage(wikiIdentifier: string, path: string): Promise<void> {
    const apiUrl = this.wikiUrl(wikiIdentifier, path);
    try {
      await this.client.delete(apiUrl, { params: { 'api-version': '7.1-preview.1' } });
      logger.info(`Deleted wiki page: ${path}`);
    } catch (err: any) {
      if (err.response?.status !== 404) {
        logger.warn(`Failed to delete wiki page ${path}: ${err.response?.status} ${err.message}`);
      }
    }
  }
}

// Shared singleton — the client is stateless beyond env-derived config, so one
// instance can be reused everywhere. Prefer this over `new AzureDevOpsClient()`.
let _sharedClient: AzureDevOpsClient | null = null;

export function getAzureDevOpsClient(): AzureDevOpsClient {
  if (!_sharedClient) _sharedClient = new AzureDevOpsClient();
  return _sharedClient;
}
