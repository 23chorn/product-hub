import { KnowledgeBaseProvider, KnowledgeBasePage, KnowledgeBaseSearchResult } from '@pap/shared';

/**
 * No-op knowledge base provider — used when KNOWLEDGE_BASE_INTEGRATION=none.
 */
export class NoneKnowledgeBaseProvider implements KnowledgeBaseProvider {
  async getPages(): Promise<KnowledgeBasePage[]> {
    return [];
  }

  async getPage(id: string): Promise<KnowledgeBasePage> {
    throw new Error(`Knowledge base integration is disabled. Cannot get page: ${id}`);
  }

  async search(_query: string, _limit?: number): Promise<KnowledgeBaseSearchResult[]> {
    return [];
  }
}
