import { RoadmapProvider, RoadmapItem } from '@pap/shared';

/**
 * No-op roadmap provider — used when ROADMAP_INTEGRATION=none.
 * Always returns empty results; no external calls are made.
 */
export class NoneRoadmapProvider implements RoadmapProvider {
  async getItems(): Promise<RoadmapItem[]> {
    return [];
  }

  async getItem(id: string): Promise<RoadmapItem> {
    throw new Error(`Roadmap integration is disabled. Cannot get item: ${id}`);
  }
}
