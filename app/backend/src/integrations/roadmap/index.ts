import { RoadmapProvider } from '@pap/shared';
import { appConfig } from '../../config/app-config';
import { NoneRoadmapProvider } from './none';
import { AirtableRoadmapProvider } from './airtable';

let _provider: RoadmapProvider | null = null;

export function getRoadmapProvider(): RoadmapProvider {
  if (!_provider) {
    switch (appConfig.integrations.roadmap) {
      case 'airtable':
        _provider = new AirtableRoadmapProvider();
        break;
      case 'none':
      default:
        _provider = new NoneRoadmapProvider();
    }
  }
  return _provider;
}

// Exported for testing
export function resetRoadmapProvider(): void {
  _provider = null;
}
