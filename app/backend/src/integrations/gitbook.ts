import axios from 'axios';
import Logger from '../utils/logger';
import { handleIntegrationError } from '../utils/error-handler';

const logger = new Logger('GITBOOK');

export interface GitBookPage {
  id?: string;
  title: string;
  markdown: string;
  parent?: string; // Parent page ID
}

export class GitBookClient {
  private baseUrl: string = 'https://api.gitbook.com/v1';
  private headers: Record<string, string>;
  private spaceId: string;
  private publicUrl: string = 'https://xcube-1.gitbook.io/xcube-documents/product/prds'; // PRD directory
  private parentPath: string = 'product/prds'; // Parent directory path in GitBook

  constructor() {
    const apiToken = process.env.GITBOOK_API_TOKEN;
    const spaceId = process.env.GITBOOK_SPACE_ID;
    const publicUrl = process.env.GITBOOK_PUBLIC_URL;
    const parentPath = process.env.GITBOOK_PARENT_PATH;

    if (!apiToken || !spaceId) {
      throw new Error('Missing GitBook environment variables');
    }

    this.spaceId = spaceId;
    if (publicUrl) {
      this.publicUrl = publicUrl;
    }
    if (parentPath) {
      this.parentPath = parentPath;
    }
    this.headers = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };

    logger.info(`GitBook configured: ${this.publicUrl}`);
  }

  /**
   * Get space information
   */
  async getSpace(): Promise<any> {
    try {
      logger.debug(`Fetching space: ${this.spaceId}`);
      const response = await axios.get(`${this.baseUrl}/spaces/${this.spaceId}`, {
        headers: this.headers,
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get space', error);
      handleIntegrationError(error, 'GitBook');
    }
  }

  /**
   * Get space content structure
   */
  async getContent(): Promise<any> {
    try {
      logger.debug('Fetching space content');
      const response = await axios.get(`${this.baseUrl}/spaces/${this.spaceId}/content`, {
        headers: this.headers,
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get content', error);
      handleIntegrationError(error, 'GitBook');
    }
  }

  /**
   * Create a new page in GitBook using Git Import
   * This creates a change request that you can review and merge in GitBook UI
   */
  async createPage(page: GitBookPage): Promise<string> {
    try {
      logger.debug(`Creating page via Git Import: ${page.title}`);

      const slug = this.slugify(page.title);

      // GitBook's API requires Git import for programmatic content creation
      // We'll use their Git Import endpoint which creates a change request
      const gitImportResponse = await axios.post(
        `${this.baseUrl}/spaces/${this.spaceId}/git/import`,
        {
          message: `Create PRD: ${page.title}`,
          files: [
            {
              path: `${this.parentPath}/${slug}.md`,
              content: page.markdown,
            }
          ],
        },
        {
          headers: this.headers,
        }
      );

      logger.info(`✅ Created Git import (change request): ${gitImportResponse.data.id || 'success'}`);

      const publicUrl = `${this.publicUrl}/${slug}`;
      logger.info(`📝 Change request created and ready for review in GitBook UI`);
      logger.info(`   Expected URL after merge: ${publicUrl}`);
      logger.info(`   ⚠️  You need to approve and merge this in GitBook UI`);

      return publicUrl;
    } catch (error: any) {
      logger.error('Failed to create via Git import', error.response?.data || error.message);

      // Fallback to file-based approach
      logger.warn('Git import method failed, falling back to file creation');
      return await this.createPageAlternative(page);
    }
  }

  /**
   * Alternative method for creating pages (for different GitBook API versions)
   */
  private async createPageAlternative(page: GitBookPage): Promise<string> {
    try {
      const slug = this.slugify(page.title);

      // Method 1: Try using change requests API
      logger.debug('Attempting change request method...');
      await axios.post(
        `${this.baseUrl}/spaces/${this.spaceId}/content/changes`,
        {
          changes: [
            {
              type: 'document-upsert',
              document: {
                type: 'document',
                title: page.title,
                slug: slug,
                body: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: page.markdown,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          headers: this.headers,
        }
      );

      logger.info(`Created GitBook page (alternative): ${page.title}`);
      const publicUrl = `${this.publicUrl}/${slug}`;
      return publicUrl;
    } catch (error: any) {
      logger.error('Alternative page creation also failed', error.response?.data || error.message);

      // Return a manual creation note
      logger.warn('Automatic page creation failed. Please create the page manually in GitBook.');
      const slug = this.slugify(page.title);
      const publicUrl = `${this.publicUrl}/${slug}`;

      // Return the URL where it SHOULD be created
      logger.info(`Expected URL (manual creation needed): ${publicUrl}`);
      return publicUrl;
    }
  }

  /**
   * Update an existing page
   */
  async updatePage(pageId: string, markdown: string): Promise<void> {
    try {
      logger.debug(`Updating page: ${pageId}`);
      await axios.patch(
        `${this.baseUrl}/spaces/${this.spaceId}/content/page/${pageId}`,
        {
          markdown,
        },
        {
          headers: this.headers,
        }
      );
      logger.info(`Updated GitBook page: ${pageId}`);
    } catch (error) {
      logger.error('Failed to update page', error);
      handleIntegrationError(error, 'GitBook');
    }
  }

  /**
   * Convert title to URL-friendly slug
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /**
   * Create a PRD markdown file locally
   * Files are saved to prds/ directory for manual upload to GitBook
   */
  async createPRD(title: string, markdown: string): Promise<string> {
    logger.info(`Creating PRD: ${title}`);

    const slug = this.slugify(title);
    const expectedUrl = `${this.publicUrl}/${slug}`;

    // Save to prds directory
    try {
      const fs = require('fs');
      const path = require('path');
      const prdsDir = path.resolve(__dirname, '../../../../prds');
      if (!fs.existsSync(prdsDir)) {
        fs.mkdirSync(prdsDir, { recursive: true });
      }
      const filename = `${slug}.md`;
      const filepath = path.join(prdsDir, filename);
      fs.writeFileSync(filepath, markdown);
      logger.info(`✅ PRD saved to: prds/${filename}`);

      // Update the index
      const indexPath = path.join(prdsDir, '_index.md');
      const timestamp = new Date().toISOString();
      const indexEntry = `- [${title}](${filename}) - Generated ${timestamp}\n`;

      if (fs.existsSync(indexPath)) {
        fs.appendFileSync(indexPath, indexEntry);
      } else {
        fs.writeFileSync(indexPath, `# Generated PRDs\n\n${indexEntry}`);
      }

      logger.info(`📝 Ready for manual upload to GitBook`);
      logger.info(`   Expected URL: ${expectedUrl}`);
    } catch (fileError) {
      logger.error('Failed to save PRD to file', fileError);
      throw fileError;
    }

    // Return the expected URL for Airtable
    return expectedUrl;
  }
}
