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

/**
 * Format per-platform technical notes from tech_refinement into an HTML section.
 * technical_notes: { ios, android, backend } — each is a free-text string.
 * Returns an empty string when no meaningful notes are present.
 */
function buildPlatformNotes(notes: { ios?: string | null; android?: string | null; backend?: string | null } | undefined): string {
  if (!notes) return '';

  const platforms = [
    { label: 'iOS', value: notes.ios },
    { label: 'Android', value: notes.android },
    { label: 'Backend', value: notes.backend },
  ].filter(p => p.value && p.value !== 'null' && p.value.trim() !== '' && p.value.trim().toLowerCase() !== 'n/a');

  if (!platforms.length) return '';

  return [
    '<hr>',
    '<b>Technical Notes</b> <i>(AI-generated · pending engineering review)</i><br>',
    platforms.map(p => `<b>${p.label}:</b> ${escapeHtml(p.value!)}`).join('<br>'),
  ].join('');
}

/**
 * Derive team tags from per-platform technical_notes.
 * A platform is tagged when its notes field is present and non-trivial.
 * Future streams (web) can be added here once the tech_refinement agent supports them.
 * Returns a semicolon-separated ADO tag string, or undefined when no tags apply.
 */
function deriveTeamTags(notes: { ios?: string | null; android?: string | null; backend?: string | null } | undefined): string | undefined {
  if (!notes) return undefined;

  const isPresent = (v: string | null | undefined) =>
    !!v && v !== 'null' && v.trim() !== '' && v.trim().toLowerCase() !== 'n/a';

  const tags: string[] = [];
  if (isPresent(notes.backend)) tags.push('Backend');
  if (isPresent(notes.ios))     tags.push('iOS');
  if (isPresent(notes.android)) tags.push('Android');
  // Web: not yet supported — add here when web tech_refinement agent is introduced

  return tags.length ? tags.join('; ') : undefined;
}

// ── Test Plans constants ──────────────────────────────────────────────────────

const SUITE_TYPE_LABELS: Record<string, string> = {
  happy_path: 'Happy Path',
  bad_path: 'Bad Path',
  edge_case: 'Edge Case',
  functional: 'Functional',
  performance: 'Performance',
  compliance: 'Compliance',
};

const TC_PRIORITY_MAP: Record<string, number> = {
  critical: 1, high: 2, medium: 3, low: 4,
};

interface TestCaseInput {
  id?: string;
  title: string;
  type?: string;
  priority?: string;
  story_ref?: string | null;
  linkedStory?: string | null;
  tags?: string[];
  scenario?: { given: string[]; when?: string[]; then: string[] };
  steps?: string[];
  expectedResult?: string;
  preconditions?: string[];
  description?: string;
}

/**
 * Build a human-readable test case description summarizing what is being tested.
 * Includes test type, linked story, preconditions, and scenario/expected result.
 */
function buildTestCaseDescription(tc: TestCaseInput): string {
  const parts: string[] = [];

  // Use explicit description if provided
  if (tc.description) {
    parts.push(escapeHtml(tc.description));
  }

  // Test type and linked story
  const metadata: string[] = [];
  if (tc.type) {
    const typeLabel = SUITE_TYPE_LABELS[tc.type] ?? tc.type;
    metadata.push(`<b>Type:</b> ${escapeHtml(typeLabel)}`);
  }
  if (tc.story_ref || tc.linkedStory) {
    metadata.push(`<b>Linked Story:</b> ${escapeHtml(tc.story_ref ?? tc.linkedStory!)}`);
  }
  if (metadata.length) {
    parts.push(metadata.join(' | '));
  }

  // Preconditions
  if (tc.preconditions && tc.preconditions.length > 0) {
    parts.push('<b>Preconditions:</b>');
    parts.push('<ul>' + tc.preconditions.map(p => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>');
  }

  // Scenario summary (Gherkin)
  if (tc.scenario) {
    parts.push('<b>Scenario:</b>');
    const scenarioParts: string[] = [];
    if (tc.scenario.given && tc.scenario.given.length > 0) {
      scenarioParts.push(`<b>Given</b> ${escapeHtml(tc.scenario.given.join(', '))}`);
    }
    if (tc.scenario.when && tc.scenario.when.length > 0) {
      scenarioParts.push(`<b>When</b> ${escapeHtml(tc.scenario.when.join(', '))}`);
    }
    if (tc.scenario.then && tc.scenario.then.length > 0) {
      scenarioParts.push(`<b>Then</b> ${escapeHtml(tc.scenario.then.join(', '))}`);
    }
    parts.push(scenarioParts.join('<br>'));
  }

  // Expected result (procedural tests)
  if (tc.expectedResult && !tc.scenario) {
    parts.push(`<b>Expected Result:</b> ${escapeHtml(tc.expectedResult)}`);
  }

  return parts.length > 0 ? parts.join('<br><br>') : '';
}

/**
 * Convert a TestCase's Gherkin scenario or procedural steps into ADO step XML.
 * Gherkin: Given/When → ActionStep; Then → ValidateStep (last Then = expected result).
 * Procedural: each step → ActionStep + final ValidateStep for expectedResult.
 */
function buildTestStepsXml(tc: TestCaseInput): string {
  type StepEntry = { type: 'ActionStep' | 'ValidateStep'; action: string; expected: string };
  const stepItems: StepEntry[] = [];

  if (tc.scenario) {
    const given = tc.scenario.given ?? [];
    const when = tc.scenario.when ?? [];
    const then = tc.scenario.then ?? [];
    for (const s of given) stepItems.push({ type: 'ActionStep', action: s, expected: '' });
    for (const s of when)  stepItems.push({ type: 'ActionStep', action: s, expected: '' });
    for (let i = 0; i < then.length; i++) {
      stepItems.push({
        type: 'ValidateStep',
        action: then[i],
        expected: i === then.length - 1 ? then[i] : '',
      });
    }
  } else if (tc.steps && tc.steps.length > 0) {
    for (const s of tc.steps) stepItems.push({ type: 'ActionStep', action: s, expected: '' });
    const expected = tc.expectedResult ?? 'Verify expected behaviour';
    stepItems.push({ type: 'ValidateStep', action: expected, expected });
  } else {
    const expected = tc.expectedResult ?? 'Verify expected behaviour';
    stepItems.push({ type: 'ActionStep', action: `Execute: ${escapeHtml(tc.title)}`, expected: '' });
    stepItems.push({ type: 'ValidateStep', action: expected, expected });
  }

  const stepXml = stepItems.map((step, i) => {
    const n = i + 1;
    return `<step id="${n}" type="${step.type}"><parameterizedString isformatted="true">${escapeHtml(step.action)}</parameterizedString><parameterizedString isformatted="true">${escapeHtml(step.expected)}</parameterizedString><description/></step>`;
  }).join('');

  return `<steps id="0" last="${stepItems.length}">${stepXml}</steps>`;
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
    this.wikiIdentifier = process.env.AZURE_DEVOPS_WIKI_ID || `${sanitizedProject}.wiki`;

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
          ].join('<br>') + buildTechnicalSuggestions(storyData.technical) + buildPlatformNotes(storyData.technical_notes);

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
            tags: deriveTeamTags(storyData.technical_notes),
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
    updates: { title?: string; description?: string; effort?: number; acceptanceCriteria?: string; aiEstimateDevHours?: number; aiEstimateQaHours?: number; tags?: string }
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
        ].join('<br>') + buildTechnicalSuggestions(storyData.technical) + buildPlatformNotes(storyData.technical_notes);

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
            tags: deriveTeamTags(storyData.technical_notes),
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

  async upsertWikiPage(wikiIdentifier: string, path: string, content: string): Promise<{ eTag: string; url: string }> {
    const apiUrl = this.wikiUrl(wikiIdentifier, path);
    // The wiki pages endpoint is preview-only — override the instance default api-version.
    const wikiParams = { 'api-version': '7.1-preview.1' };
    logger.info(`Wiki API URL: ${apiUrl} (wikiId: ${wikiIdentifier})`);

    // GET existing page to retrieve ETag (needed for updates — ADO requires it)
    let currentETag: string | undefined;
    try {
      const existing = await this.client.get(apiUrl, {
        headers: { 'Content-Type': 'application/json' },
        params: wikiParams,
      });
      currentETag = existing.headers['etag'];
    } catch { /* page doesn't exist yet — will create */ }

    try {
      const response = await this.client.put(
        apiUrl,
        { content },
        {
          headers: { 'Content-Type': 'application/json', 'If-Match': currentETag ?? '*' },
          params: wikiParams,
        }
      );
      const eTag: string = response.headers['etag'] ?? '';
      const pageUrl = this.getWikiPageUrl(wikiIdentifier, path);
      logger.info(`Wiki page upserted: ${path}`);
      return { eTag, url: pageUrl };
    } catch (error: any) {
      logger.error(`Failed to upsert wiki page ${path}`, error?.response?.data ?? error.message);
      throw new Error(`Wiki API error: ${error.response?.data?.message || error.message}`);
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
      } catch {
        try {
          await this.client.put(
            apiUrl,
            { content: `# ${segments[i - 1]}` },
            { headers: { 'Content-Type': 'application/json', 'If-Match': '*' }, params: wikiParams }
          );
        } catch { /* may already exist from concurrent call — ignore */ }
      }
    }
  }

  // ── Test Plans API ────────────────────────────────────────────────────────────

  /** Create a new ADO Test Plan. Returns planId, rootSuiteId, and browser URL. */
  async createTestPlan(name: string): Promise<{ planId: number; rootSuiteId: number; planUrl: string }> {
    try {
      const response = await this.client.post('/testplan/plans', { name }, {
        headers: { 'Content-Type': 'application/json' },
      });
      const planId = response.data.id as number;
      const rootSuiteId = response.data.rootSuite?.id as number;
      return {
        planId,
        rootSuiteId,
        planUrl: `https://dev.azure.com/${this.organization}/${this.project}/_testPlans/define?planId=${planId}`,
      };
    } catch (error: any) {
      throw new Error(`Failed to create test plan: ${error.response?.data?.message || error.message}`);
    }
  }

  /** Create a static test suite as a child of parentSuiteId inside a plan. */
  async createTestSuite(planId: number, name: string, parentSuiteId: number): Promise<{ suiteId: number }> {
    try {
      const response = await this.client.post(`/testplan/plans/${planId}/suites`, {
        suiteType: 'StaticTestSuite',
        name,
        parentSuite: { id: parentSuiteId },
      }, {
        headers: { 'Content-Type': 'application/json' },
      });
      return { suiteId: response.data.id as number };
    } catch (error: any) {
      throw new Error(`Failed to create test suite "${name}": ${error.response?.data?.message || error.message}`);
    }
  }

  /** Create a Test Case work item with steps XML and optional TestedBy link. */
  async createTestCaseWorkItem(params: {
    title: string;
    description?: string;
    stepsXml: string;
    priority: number;
    tags?: string;
    storyAdoId?: number;
  }): Promise<{ testCaseId: number }> {
    const operations: any[] = [
      { op: 'add', path: '/fields/System.Title', value: params.title },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: params.stepsXml },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: params.priority },
    ];

    if (params.description) {
      operations.push({ op: 'add', path: '/fields/System.Description', value: params.description });
    }

    if (params.tags) {
      operations.push({ op: 'add', path: '/fields/System.Tags', value: params.tags });
    }

    if (params.storyAdoId) {
      operations.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
          url: `https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workItems/${params.storyAdoId}`,
        },
      });
    }

    try {
      const response = await this.client.post('/wit/workitems/$Test%20Case', operations);
      return { testCaseId: response.data.id as number };
    } catch (error: any) {
      throw new Error(`Failed to create test case "${params.title}": ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Add a TestedBy-Reverse relation from a test case to a user story.
   * Silently swallows duplicate-link errors so re-syncs are idempotent.
   */
  async addTestedByLink(testCaseId: number, storyAdoId: number): Promise<void> {
    try {
      await this.client.patch(`/wit/workitems/${testCaseId}`, [
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
            url: `https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workItems/${storyAdoId}`,
          },
        },
      ]);
    } catch (error: any) {
      const msg: string = error.response?.data?.message ?? error.message ?? '';
      // ADO returns a 400 with "duplicate" in the message when the link already exists
      if (/duplicate|already exists/i.test(msg)) return;
      logger.warn(`addTestedByLink: tc #${testCaseId} → story #${storyAdoId}: ${msg}`);
    }
  }

  /** Update an existing Test Case work item's title, steps, priority, tags, and description. */
  async updateTestCaseWorkItem(testCaseId: number, params: {
    title: string;
    description?: string;
    stepsXml: string;
    priority: number;
    tags?: string;
  }): Promise<void> {
    const operations: any[] = [
      { op: 'replace', path: '/fields/System.Title', value: params.title },
      { op: 'replace', path: '/fields/Microsoft.VSTS.TCM.Steps', value: params.stepsXml },
      { op: 'replace', path: '/fields/Microsoft.VSTS.Common.Priority', value: params.priority },
    ];

    if (params.description !== undefined) {
      operations.push({ op: 'replace', path: '/fields/System.Description', value: params.description });
    }

    if (params.tags !== undefined) {
      operations.push({ op: 'replace', path: '/fields/System.Tags', value: params.tags });
    }

    try {
      await this.client.patch(`/wit/workitems/${testCaseId}`, operations);
    } catch (error: any) {
      throw new Error(`Failed to update test case #${testCaseId}: ${error.response?.data?.message || error.message}`);
    }
  }

  /** Add existing test case work items to a test suite. */
  async addTestCasesToSuite(planId: number, suiteId: number, testCaseIds: number[]): Promise<void> {
    if (testCaseIds.length === 0) return;
    // Use the older /test API — it accepts comma-separated IDs in the URL and is reliably supported.
    // The newer /testplan POST endpoint is preview-only and returns 404 with api-version 7.1.
    const ids = testCaseIds.join(',');
    try {
      await this.client.post(
        `/test/plans/${planId}/suites/${suiteId}/testcases/${ids}`,
        null,
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      throw new Error(`Failed to add test cases to suite: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Push or sync a QA test suite to ADO Test Plans.
   * Creates a plan + per-type suites on first push; updates existing test cases and
   * adds new ones on subsequent pushes. Returns accumulated IDs and counts.
   */
  async pushQATestPlan(params: {
    planName: string;
    testCases: TestCaseInput[];
    storyMap: Map<string, number>;
    existing?: {
      planId: number;
      rootSuiteId?: number;
      suiteIds: Record<string, number>;
      testCaseIds: Record<string, number>;
    };
  }): Promise<{
    planId: number;
    rootSuiteId: number;
    planUrl: string;
    suiteIds: Record<string, number>;
    testCaseIds: Record<string, number>;
    created: number;
    updated: number;
  }> {
    const { planName, testCases, storyMap, existing } = params;

    let planId: number;
    let rootSuiteId: number;
    let planUrl: string;

    if (existing) {
      planId = existing.planId;
      planUrl = `https://dev.azure.com/${this.organization}/${this.project}/_testPlans/define?planId=${planId}`;
      // Fetch root suite from ADO if not cached
      if (existing.rootSuiteId) {
        rootSuiteId = existing.rootSuiteId;
      } else {
        const planRes = await this.client.get(`/testplan/plans/${planId}`, {
          headers: { 'Content-Type': 'application/json' },
        });
        rootSuiteId = planRes.data.rootSuite?.id as number;
      }
    } else {
      const plan = await this.createTestPlan(planName);
      planId = plan.planId;
      rootSuiteId = plan.rootSuiteId;
      planUrl = plan.planUrl;
    }

    const suiteIds: Record<string, number> = existing?.suiteIds ? { ...existing.suiteIds } : {};
    const testCaseIds: Record<string, number> = existing?.testCaseIds ? { ...existing.testCaseIds } : {};
    let created = 0;
    let updated = 0;

    // Group test cases by type
    const byType = new Map<string, TestCaseInput[]>();
    for (const tc of testCases) {
      const type = tc.type ?? 'functional';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(tc);
    }

    for (const [type, cases] of byType) {
      if (!suiteIds[type]) {
        const label = SUITE_TYPE_LABELS[type] ?? type;
        const suite = await this.createTestSuite(planId, label, rootSuiteId);
        suiteIds[type] = suite.suiteId;
      }
      const suiteId = suiteIds[type];
      const newTestCaseAdoIds: number[] = [];

      for (const tc of cases) {
        const stepsXml = buildTestStepsXml(tc);
        const description = buildTestCaseDescription(tc);
        const priority = TC_PRIORITY_MAP[(tc.priority ?? 'medium').toLowerCase()] ?? 3;
        const tags = Array.isArray(tc.tags) && tc.tags.length ? tc.tags.join('; ') : undefined;
        const storyRef = tc.story_ref ?? tc.linkedStory ?? null;
        const storyAdoId = storyRef ? storyMap.get(storyRef) : undefined;

        if (storyRef && !storyAdoId) {
          logger.warn(`Test case ${tc.id} references story "${storyRef}" but no ADO ID found in storyMap`);
        }

        if (tc.id && testCaseIds[tc.id]) {
          await this.updateTestCaseWorkItem(testCaseIds[tc.id], { title: tc.title, description, stepsXml, priority, tags });
          if (storyAdoId) {
            logger.info(`Adding TestedBy link: tc #${testCaseIds[tc.id]} → story #${storyAdoId} (${storyRef})`);
            await this.addTestedByLink(testCaseIds[tc.id], storyAdoId);
          }
          updated++;
        } else {
          if (storyAdoId) {
            logger.info(`Creating test case with TestedBy link: "${tc.title}" → story #${storyAdoId} (${storyRef})`);
          }
          const { testCaseId } = await this.createTestCaseWorkItem({ title: tc.title, description, stepsXml, priority, tags, storyAdoId });
          if (tc.id) testCaseIds[tc.id] = testCaseId;
          newTestCaseAdoIds.push(testCaseId);
          created++;
        }
      }

      if (newTestCaseAdoIds.length > 0) {
        await this.addTestCasesToSuite(planId, suiteId, newTestCaseAdoIds);
      }
    }

    logger.info(`Test plan push: planId=${planId}, ${created} created, ${updated} updated`);
    return { planId, rootSuiteId, planUrl, suiteIds, testCaseIds, created, updated };
  }
}
