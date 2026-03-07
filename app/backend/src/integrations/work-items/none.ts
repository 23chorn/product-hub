import { WorkItemProvider, WorkItemProviderEpic, WorkItemProviderStory } from '@pap/shared';

/**
 * No-op work items provider — used when WORK_ITEMS_INTEGRATION=none.
 * All mutation methods throw; no external calls are made.
 */
export class NoneWorkItemProvider implements WorkItemProvider {
  async createEpic(_title: string, _description?: string): Promise<WorkItemProviderEpic> {
    throw new Error('Work items integration is disabled (WORK_ITEMS_INTEGRATION=none).');
  }

  async createStory(_title: string, _description: string, _epicId: string): Promise<WorkItemProviderStory> {
    throw new Error('Work items integration is disabled (WORK_ITEMS_INTEGRATION=none).');
  }

  async createTask(_title: string, _description: string, _storyId: string): Promise<{ id: string }> {
    throw new Error('Work items integration is disabled (WORK_ITEMS_INTEGRATION=none).');
  }

  async linkDependency(_fromId: string, _toId: string): Promise<void> {
    throw new Error('Work items integration is disabled (WORK_ITEMS_INTEGRATION=none).');
  }
}
