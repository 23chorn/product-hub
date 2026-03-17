import { KnowledgeBaseProvider, KnowledgeBasePage, KnowledgeBaseSearchResult } from '@pap/shared';
import { GitBookClient } from '../gitbook';
import Logger from '../../utils/logger';

const logger = new Logger('KB-GITBOOK');

/**
 * GitBook knowledge base provider.
 *
 * Wraps the existing GitBookClient to expose search and page retrieval
 * through the KnowledgeBaseProvider interface.
 *
 * Required env vars: GITBOOK_API_TOKEN, GITBOOK_SPACE_ID
 * Optional: GITBOOK_PUBLIC_URL, GITBOOK_PARENT_PATH
 */
export class GitBookKnowledgeBaseProvider implements KnowledgeBaseProvider {
  private client: GitBookClient;

  constructor() {
    this.client = new GitBookClient();
    logger.info('GitBook knowledge base provider initialised');
  }

  async getPages(): Promise<KnowledgeBasePage[]> {
    const content = await this.client.getContent();
    const pages: KnowledgeBasePage[] = (content?.pages ?? []).map((p: any) => ({
      id: p.id ?? '',
      title: p.title ?? '(untitled)',
      content: p.markdown ?? p.description ?? '',
    }));
    return pages;
  }

  async getPage(id: string): Promise<KnowledgeBasePage> {
    const content = await this.client.getContent();
    const page = (content?.pages ?? []).find((p: any) => p.id === id);
    if (!page) throw new Error(`GitBook page not found: ${id}`);
    return { id: page.id, title: page.title ?? '(untitled)', content: page.markdown ?? '' };
  }

  async search(query: string, limit: number = 5): Promise<KnowledgeBaseSearchResult[]> {
    const results = await this.client.searchPages(query, limit);
    return results.map(r => ({
      title: r.title,
      body: r.body,
      url: r.url,
    }));
  }
}
