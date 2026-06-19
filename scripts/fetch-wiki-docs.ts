#!/usr/bin/env node
/**
 * Fetch all documents from the Azure Wiki "xCube Docs" section
 * and save them to a behaviour folder with a tree map.
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import 'dotenv/config';

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
};

interface WikiPage {
  id: number;
  path: string;
  url?: string;
  content?: string;
  subPages?: WikiPage[];
}

class WikiFetcher {
  private client;
  private organization: string;
  private project: string;
  private wikiId: string;

  constructor() {
    const orgValue = process.env.AZURE_DEVOPS_ORG || '';
    if (orgValue.includes('dev.azure.com')) {
      const match = orgValue.match(/dev\.azure\.com\/([^\/]+)/);
      this.organization = match ? match[1] : orgValue;
    } else {
      this.organization = orgValue;
    }

    this.project = process.env.AZURE_DEVOPS_PROJECT || '';
    const pat = process.env.AZURE_DEVOPS_PAT || '';

    let wikiIdValue = process.env.AZURE_DEVOPS_WIKI_ID || '';
    if (wikiIdValue.includes('_wiki/wikis/')) {
      const match = wikiIdValue.match(/_wiki\/wikis\/([^\/]+)/);
      this.wikiId = match ? match[1] : wikiIdValue;
    } else {
      this.wikiId = wikiIdValue;
    }

    this.client = axios.create({
      baseURL: `https://dev.azure.com/${this.organization}/${this.project}/_apis`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
      },
    });

    logger.info(`Wiki Fetcher configured: ${this.organization}/${this.project} - Wiki: ${this.wikiId}`);
  }

  private wikiUrl(path?: string): string {
    const doubleEncoded = encodeURIComponent(encodeURIComponent(this.wikiId));
    if (path) {
      const encodedPath = path.split('/').map(s => encodeURIComponent(s)).join('/');
      return `/wiki/wikis/${doubleEncoded}/pages?path=${encodedPath}&api-version=7.1-preview.1&includeContent=true`;
    }
    return `/wiki/wikis/${doubleEncoded}/pages?recursionLevel=full&api-version=7.1-preview.1`;
  }

  async getWikiStructure(): Promise<WikiPage> {
    try {
      logger.info('Fetching wiki structure...');
      const response = await this.client.get(this.wikiUrl());
      return response.data;
    } catch (error: any) {
      logger.error('Failed to fetch wiki structure:', error.response?.data || error.message);
      throw error;
    }
  }

  async getPageContent(pagePath: string): Promise<string> {
    try {
      const response = await this.client.get(this.wikiUrl(pagePath));
      return response.data.content || '';
    } catch (error: any) {
      logger.error(`Failed to fetch page content for ${pagePath}:`, error.response?.data || error.message);
      return '';
    }
  }

  async fetchAllPages(page: WikiPage, prefix: string = ''): Promise<Array<{ path: string; content: string }>> {
    const pages: Array<{ path: string; content: string }> = [];

    // Fetch content for this page if it has a path (not root)
    if (page.path && page.path !== '/') {
      logger.info(`Fetching content for: ${page.path}`);
      const content = await this.getPageContent(page.path);
      pages.push({ path: page.path, content });
    }

    // Recursively fetch subpages
    if (page.subPages && page.subPages.length > 0) {
      for (const subPage of page.subPages) {
        const subPages = await this.fetchAllPages(subPage, prefix);
        pages.push(...subPages);
      }
    }

    return pages;
  }

  findXCubeDocsSection(page: WikiPage): WikiPage | null {
    // Check if this page is "xCube Docs"
    if (page.path && page.path.toLowerCase().includes('xcube docs')) {
      return page;
    }

    // Search in subpages
    if (page.subPages && page.subPages.length > 0) {
      for (const subPage of page.subPages) {
        const found = this.findXCubeDocsSection(subPage);
        if (found) return found;
      }
    }

    return null;
  }
}

async function main() {
  const fetcher = new WikiFetcher();

  // Create behaviour directory
  const behaviorDir = path.join(process.cwd(), 'context', 'behaviour');
  if (!fs.existsSync(behaviorDir)) {
    fs.mkdirSync(behaviorDir, { recursive: true });
    logger.info(`Created directory: ${behaviorDir}`);
  }

  // Get wiki structure
  logger.info('Fetching wiki structure...');
  const wikiRoot = await fetcher.getWikiStructure();

  // Find xCube Docs section
  logger.info('Looking for xCube Docs section...');
  const xCubeDocs = fetcher.findXCubeDocsSection(wikiRoot);

  if (!xCubeDocs) {
    logger.error('xCube Docs section not found in wiki!');
    logger.info('Available pages:', JSON.stringify(wikiRoot, null, 2));
    process.exit(1);
  }

  logger.info(`Found xCube Docs at: ${xCubeDocs.path}`);

  // Fetch all pages under xCube Docs
  logger.info('Fetching all pages under xCube Docs...');
  const pages = await fetcher.fetchAllPages(xCubeDocs);

  logger.info(`Fetched ${pages.length} pages`);

  // Create tree map
  const treeMap: any = {
    root: 'xCube Docs',
    timestamp: new Date().toISOString(),
    structure: xCubeDocs,
    pageCount: pages.length,
  };

  // Save tree map
  const treeMapPath = path.join(behaviorDir, 'tree-map.json');
  fs.writeFileSync(treeMapPath, JSON.stringify(treeMap, null, 2));
  logger.info(`Saved tree map to: ${treeMapPath}`);

  // Save each page
  for (const page of pages) {
    const safePath = page.path
      .replace(/^\//, '')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .toLowerCase();

    const filePath = path.join(behaviorDir, `${safePath}.md`);
    fs.writeFileSync(filePath, page.content);
    logger.info(`Saved: ${filePath}`);
  }

  logger.info('✓ All wiki documents fetched successfully!');
  logger.info(`Documents saved to: ${behaviorDir}`);
}

main().catch(error => {
  logger.error('Script failed:', error);
  process.exit(1);
});
