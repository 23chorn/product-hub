import { WorkItemProvider, WorkItemProviderEpic, WorkItemProviderStory } from '@pap/shared';
import { AzureDevOpsClient } from '../azure-devops';

/**
 * Azure DevOps work items provider — adapts AzureDevOpsClient to WorkItemProvider.
 */
export class AdoWorkItemProvider implements WorkItemProvider {
  private client: AzureDevOpsClient;

  constructor() {
    this.client = new AzureDevOpsClient();
  }

  async createEpic(title: string, description?: string): Promise<WorkItemProviderEpic> {
    const item = await this.client.createWorkItem({ type: 'Epic', title, description });
    return {
      id: String(item.id),
      url: item.id ? this.client.getEpicUrl(item.id) : undefined,
    };
  }

  async createStory(title: string, description: string, epicId: string): Promise<WorkItemProviderStory> {
    const item = await this.client.createWorkItem({
      type: 'User Story',
      title,
      description,
      parentId: parseInt(epicId, 10),
    });
    return { id: String(item.id) };
  }

  async createTask(title: string, description: string, storyId: string): Promise<{ id: string }> {
    const item = await this.client.createWorkItem({
      type: 'Task',
      title,
      description,
      parentId: parseInt(storyId, 10),
    });
    return { id: String(item.id) };
  }

  async linkDependency(_fromId: string, _toId: string): Promise<void> {
    // ADO dependency linking requires PATCH on existing work items — not yet implemented
    throw new Error('linkDependency is not yet implemented for the ADO provider.');
  }
}
