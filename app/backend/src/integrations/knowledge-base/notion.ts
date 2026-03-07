import { KnowledgeBaseProvider, KnowledgeBasePage } from '@pap/shared';
import Logger from '../../utils/logger';

const logger = new Logger('NOTION');

/**
 * Notion knowledge base provider.
 *
 * Required env vars:
 *   NOTION_API_KEY      — Notion integration secret (starts with "secret_")
 *   NOTION_DATABASE_ID  — ID of the Notion database to read pages from
 *
 * The integration must be connected to the target database in Notion settings.
 * Pages are fetched as plain text (rich_text blocks concatenated).
 */
export class NotionKnowledgeBaseProvider implements KnowledgeBaseProvider {
  private apiKey: string;
  private databaseId: string;
  private baseUrl = 'https://api.notion.com/v1';
  private headers: Record<string, string>;

  constructor() {
    const apiKey = process.env.NOTION_API_KEY || '';
    const databaseId = process.env.NOTION_DATABASE_ID || '';

    if (!apiKey || !databaseId) {
      throw new Error('Missing Notion configuration. Set NOTION_API_KEY and NOTION_DATABASE_ID.');
    }

    this.apiKey = apiKey;
    this.databaseId = databaseId;
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };

    logger.info(`Notion configured: database ${this.databaseId}`);
  }

  async getPages(): Promise<KnowledgeBasePage[]> {
    try {
      const { default: axios } = await import('axios');
      logger.debug(`Querying Notion database: ${this.databaseId}`);

      const response = await axios.post(
        `${this.baseUrl}/databases/${this.databaseId}/query`,
        {},
        { headers: this.headers }
      );

      const pages: KnowledgeBasePage[] = [];
      for (const result of response.data.results ?? []) {
        const title = this.extractTitle(result);
        const content = await this.fetchPageContent(result.id);
        pages.push({ id: result.id, title, content });
      }

      logger.info(`Fetched ${pages.length} pages from Notion`);
      return pages;
    } catch (error: any) {
      logger.error('Failed to query Notion database', error);
      throw new Error(`Notion API error: ${error.response?.data?.message || error.message}`);
    }
  }

  async getPage(id: string): Promise<KnowledgeBasePage> {
    try {
      const { default: axios } = await import('axios');
      const [pageResponse, content] = await Promise.all([
        axios.get(`${this.baseUrl}/pages/${id}`, { headers: this.headers }),
        this.fetchPageContent(id),
      ]);
      return {
        id,
        title: this.extractTitle(pageResponse.data),
        content,
      };
    } catch (error: any) {
      logger.error(`Failed to get Notion page ${id}`, error);
      throw new Error(`Notion API error: ${error.response?.data?.message || error.message}`);
    }
  }

  private async fetchPageContent(pageId: string): Promise<string> {
    try {
      const { default: axios } = await import('axios');
      const response = await axios.get(`${this.baseUrl}/blocks/${pageId}/children`, {
        headers: this.headers,
      });

      return (response.data.results ?? [])
        .map((block: any) => this.blockToText(block))
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }

  private extractTitle(page: any): string {
    // Notion pages store title in properties.Name or properties.title
    const props = page.properties ?? {};
    const titleProp = props.Name ?? props.title ?? Object.values(props).find((p: any) => p.type === 'title');
    if (!titleProp) return page.id;
    const titleArr = (titleProp as any).title ?? [];
    return titleArr.map((t: any) => t.plain_text ?? '').join('') || page.id;
  }

  private blockToText(block: any): string {
    const type = block.type;
    const blockData = block[type];
    if (!blockData?.rich_text) return '';
    return blockData.rich_text.map((t: any) => t.plain_text ?? '').join('');
  }
}
