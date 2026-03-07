import { RoadmapProvider, RoadmapItem } from '@pap/shared';
import { AirtableClient } from '../airtable';

/**
 * Airtable roadmap provider — adapts AirtableClient to the RoadmapProvider interface.
 */
export class AirtableRoadmapProvider implements RoadmapProvider {
  private client: AirtableClient;

  constructor() {
    this.client = new AirtableClient();
  }

  async getItems(): Promise<RoadmapItem[]> {
    const items = await this.client.listItems();
    return (items ?? []).map(item => ({
      id: item.id,
      title: item.initiative,
      description: item.description,
      status: item.status,
    }));
  }

  async getItem(id: string): Promise<RoadmapItem> {
    const item = await this.client.getItem(id);
    return {
      id: item.id,
      title: item.initiative,
      description: item.description,
      status: item.status,
    };
  }
}
