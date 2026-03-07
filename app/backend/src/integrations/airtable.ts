import axios from 'axios';
import { AirtableItem } from '@pap/shared';
import Logger from '../utils/logger';
import { handleIntegrationError } from '../utils/error-handler';
import { appConfig } from '../config/app-config';
import { MOCK_ITEMS_NEEDING_PRD, MOCK_ITEMS_NEEDING_BACKLOG, MOCK_ITEMS } from '../../../../tests/fixtures/mock-airtable-data';

const logger = new Logger('AIRTABLE');

function isMockMode(): boolean {
  return appConfig.server.useMockData;
}

export class AirtableClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = process.env.AIRTABLE_TABLE_NAME;

    if (!apiKey || !baseId || !tableName) {
      throw new Error('Missing Airtable environment variables');
    }

    this.baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get a single item by ID
   */
  async getItem(recordId: string): Promise<AirtableItem> {
    if (isMockMode()) {
      logger.info(`[MOCK] getItem: ${recordId}`);
      const item = MOCK_ITEMS.find(i => i.id === recordId);
      if (!item) throw new Error(`Mock item not found: ${recordId}`);
      return item;
    }
    try {
      logger.debug(`Fetching item: ${recordId}`);
      const response = await axios.get(`${this.baseUrl}/${recordId}`, {
        headers: this.headers,
      });
      return this.transformRecord(response.data);
    } catch (error) {
      logger.error(`Failed to get item ${recordId}`, error);
      handleIntegrationError(error, 'Airtable');
    }
  }

  /**
   * List items with optional filter
   */
  async listItems(filter?: string): Promise<AirtableItem[]> {
    try {
      const params: any = {};
      if (filter) {
        params.filterByFormula = filter;
      }

      logger.debug('Listing items with filter:', filter || 'none');
      const response = await axios.get(this.baseUrl, {
        headers: this.headers,
        params,
      });

      return response.data.records.map((record: any) => this.transformRecord(record));
    } catch (error: any) {
      logger.error('Failed to list items', error);
      if (error.response?.data) {
        logger.error('Airtable error body:', JSON.stringify(error.response.data));
      }
      handleIntegrationError(error, 'Airtable');
    }
  }

  /**
   * List items that need PRDs
   * Criteria: Status is "Discovery" or "Ready", no PRD Link, and requires dev work
   */
  async getItemsNeedingPRD(): Promise<AirtableItem[]> {
    if (isMockMode()) {
      logger.info('[MOCK] getItemsNeedingPRD');
      return MOCK_ITEMS_NEEDING_PRD;
    }
    return this.listItems(
      "AND(OR({Status} = 'Discovery', {Status} = 'Ready'), NOT({PRD Link}), {Requires Dev Work} = 'Yes')"
    );
  }

  /**
   * List items ready for backlog creation
   * Criteria: Status is "In Progress", has PRD Link, no Epic Link yet
   */
  async getItemsNeedingBacklog(): Promise<AirtableItem[]> {
    if (isMockMode()) {
      logger.info('[MOCK] getItemsNeedingBacklog');
      return MOCK_ITEMS_NEEDING_BACKLOG;
    }
    return this.listItems(
      "AND({Status} = 'In Progress', {PRD Link}, NOT({Epic Link}))"
    );
  }

  /**
   * Update an item with PRD link
   */
  async updateItem(recordId: string, updates: Partial<AirtableItem>): Promise<void> {
    if (isMockMode()) {
      logger.info(`[MOCK] updateItem ${recordId} (no-op)`);
      return;
    }
    try {
      logger.debug(`Updating item ${recordId}`, updates);
      await axios.patch(
        `${this.baseUrl}/${recordId}`,
        {
          fields: this.transformToAirtableFields(updates),
        },
        {
          headers: this.headers,
        }
      );
      logger.info(`Updated item ${recordId} successfully`);
    } catch (error) {
      logger.error(`Failed to update item ${recordId}`, error);
      handleIntegrationError(error, 'Airtable');
    }
  }

  /**
   * Update item with PRD link
   */
  async linkPRD(recordId: string, prdLink: string): Promise<void> {
    await this.updateItem(recordId, {
      prdLink,
    });
  }

  /**
   * Update item with Azure DevOps Epic/Feature/Story IDs and links
   */
  async linkAzureDevOps(
    recordId: string,
    epicId: string,
    epicUrl: string,
    featureIds: string,
    storyIds: string
  ): Promise<void> {
    await this.updateItem(recordId, {
      epicLink: epicUrl,
      azureEpicId: epicId,
      azureFeatureIds: featureIds,
      azureStoryIds: storyIds,
    });
  }

  /**
   * Transform Airtable record to our internal format
   */
  private transformRecord(record: any): AirtableItem {
    return {
      id: record.id,
      initiative: record.fields['Initiative'] || '',
      description: record.fields['Description'] || '',
      status: record.fields['Status'] || 'Discovery',
      businessValue: record.fields['Business Value'] || 5,
      priorityScore: record.fields['Priority Score'] || 0,
      estimate: record.fields['Estimate'] || 'M',
      confidence: record.fields['Confidence'] || 0.5,
      targetQuarter: record.fields['Target Quarter'],
      targetWindow: record.fields['Target Window'],
      productArea: record.fields['Product Area'],
      strategicTheme: record.fields['Strategic Theme'],
      affectedStakeholders: record.fields['Affected Stakeholders'],
      requiresDevWork: record.fields['Requires Dev Work'],
      plannedStartDate: record.fields['Planned Start Date'],
      plannedEndDate: record.fields['Planned End Date'],
      notes: record.fields['Notes'],
      releaseLogs: record.fields['Release Logs'],
      owner: record.fields['Owner'] || '',
      prdLink: record.fields['PRD Link'] || '',
      epicLink: record.fields['Epic Link'] || '',
      azureEpicId: record.fields['Azure Epic ID'] || '',
      azureFeatureIds: record.fields['Azure Feature IDs'] || '',
      azureStoryIds: record.fields['Azure Story IDs'] || '',
      createdAt: record.createdTime,
      lastModified: record.fields['Last Modified'],
    };
  }

  /**
   * Transform our format to Airtable fields
   */
  private transformToAirtableFields(item: Partial<AirtableItem>): any {
    const fields: any = {};
    if (item.initiative !== undefined) fields['Initiative'] = item.initiative;
    if (item.description !== undefined) fields['Description'] = item.description;
    if (item.status !== undefined) fields['Status'] = item.status;
    if (item.businessValue !== undefined) fields['Business Value'] = item.businessValue;
    if (item.estimate !== undefined) fields['Estimate'] = item.estimate;
    if (item.confidence !== undefined) fields['Confidence'] = item.confidence;
    if (item.targetQuarter !== undefined) fields['Target Quarter'] = item.targetQuarter;
    if (item.targetWindow !== undefined) fields['Target Window'] = item.targetWindow;
    if (item.productArea !== undefined) fields['Product Area'] = item.productArea;
    if (item.strategicTheme !== undefined) fields['Strategic Theme'] = item.strategicTheme;
    if (item.affectedStakeholders !== undefined) fields['Affected Stakeholders'] = item.affectedStakeholders;
    if (item.requiresDevWork !== undefined) fields['Requires Dev Work'] = item.requiresDevWork;
    if (item.notes !== undefined) fields['Notes'] = item.notes;
    if (item.owner !== undefined) fields['Owner'] = item.owner;
    if (item.prdLink !== undefined) fields['PRD Link'] = item.prdLink;
    if (item.epicLink !== undefined) fields['Epic Link'] = item.epicLink;
    if (item.azureEpicId !== undefined) fields['Azure Epic ID'] = item.azureEpicId;
    if (item.azureFeatureIds !== undefined) fields['Azure Feature IDs'] = item.azureFeatureIds;
    if (item.azureStoryIds !== undefined) fields['Azure Story IDs'] = item.azureStoryIds;
    return fields;
  }
}
