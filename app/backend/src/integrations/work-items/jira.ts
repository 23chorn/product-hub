import axios, { AxiosInstance } from 'axios';
import { WorkItemProvider, WorkItemProviderEpic, WorkItemProviderStory } from '@pap/shared';
import Logger from '../../utils/logger';

const logger = new Logger('JIRA');

/**
 * Jira work items provider.
 *
 * Required env vars:
 *   JIRA_HOST         — e.g. "https://yourorg.atlassian.net"
 *   JIRA_EMAIL        — Atlassian account email
 *   JIRA_API_TOKEN    — Atlassian API token (not password)
 *   JIRA_PROJECT_KEY  — e.g. "MYPROJ"
 *
 * Optional env vars:
 *   JIRA_EPIC_TYPE    — issue type name for epics (default: "Epic")
 *   JIRA_STORY_TYPE   — issue type name for stories (default: "Story")
 *   JIRA_TASK_TYPE    — issue type name for tasks (default: "Task")
 */
export class JiraWorkItemProvider implements WorkItemProvider {
  private client: AxiosInstance;
  private projectKey: string;
  private host: string;
  private epicType: string;
  private storyType: string;
  private taskType: string;

  constructor() {
    const host = process.env.JIRA_HOST || '';
    const email = process.env.JIRA_EMAIL || '';
    const token = process.env.JIRA_API_TOKEN || '';
    this.projectKey = process.env.JIRA_PROJECT_KEY || '';
    this.host = host;
    this.epicType = process.env.JIRA_EPIC_TYPE || 'Epic';
    this.storyType = process.env.JIRA_STORY_TYPE || 'Story';
    this.taskType = process.env.JIRA_TASK_TYPE || 'Task';

    if (!host || !email || !token || !this.projectKey) {
      throw new Error(
        'Missing Jira configuration. Set JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_PROJECT_KEY.'
      );
    }

    this.client = axios.create({
      baseURL: `${host}/rest/api/3`,
      auth: { username: email, password: token },
      headers: { 'Content-Type': 'application/json' },
    });

    logger.info(`Jira configured: ${host} / project ${this.projectKey}`);
  }

  async createEpic(title: string, description?: string): Promise<WorkItemProviderEpic> {
    const issue = await this.createIssue(this.epicType, title, description);
    return {
      id: issue.key,
      url: `${this.host}/browse/${issue.key}`,
    };
  }

  async createStory(title: string, description: string, epicId: string): Promise<WorkItemProviderStory> {
    const issue = await this.createIssue(this.storyType, title, description, epicId);
    return {
      id: issue.key,
      url: `${this.host}/browse/${issue.key}`,
    };
  }

  async createTask(title: string, description: string, storyId: string): Promise<{ id: string }> {
    const issue = await this.createIssue(this.taskType, title, description, storyId);
    return { id: issue.key };
  }

  async linkDependency(fromId: string, toId: string): Promise<void> {
    try {
      await this.client.post('/issueLink', {
        type: { name: 'Blocks' },
        inwardIssue: { key: toId },
        outwardIssue: { key: fromId },
      });
      logger.info(`Linked dependency: ${fromId} blocks ${toId}`);
    } catch (error: any) {
      logger.error(`Failed to link dependency ${fromId} → ${toId}`, error);
      throw new Error(`Jira API error: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }

  private async createIssue(
    issueType: string,
    title: string,
    description?: string,
    parentKey?: string
  ): Promise<{ key: string }> {
    const fields: any = {
      project: { key: this.projectKey },
      issuetype: { name: issueType },
      summary: title,
    };

    if (description) {
      // Jira Cloud uses Atlassian Document Format for descriptions
      fields.description = {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
      };
    }

    if (parentKey) {
      fields.parent = { key: parentKey };
    }

    try {
      logger.info(`Creating Jira ${issueType}: ${title}`);
      const response = await this.client.post('/issue', { fields });
      logger.info(`Created ${issueType} ${response.data.key}: ${title}`);
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to create Jira ${issueType}`, error);
      if (error.response?.data) {
        logger.error('Jira error:', JSON.stringify(error.response.data));
      }
      throw new Error(`Jira API error: ${error.response?.data?.errorMessages?.join(', ') || error.message}`);
    }
  }
}
