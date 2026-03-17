import { KnowledgeBaseProvider } from '@pap/shared';
import { appConfig } from '../../config/app-config';
import { NoneKnowledgeBaseProvider } from './none';
import { NotionKnowledgeBaseProvider } from './notion';
import { GitBookKnowledgeBaseProvider } from './gitbook';

let _provider: KnowledgeBaseProvider | null = null;

export function getKnowledgeBaseProvider(): KnowledgeBaseProvider {
  if (!_provider) {
    switch (appConfig.integrations.knowledgeBase) {
      case 'notion':
        _provider = new NotionKnowledgeBaseProvider();
        break;
      case 'gitbook':
        _provider = new GitBookKnowledgeBaseProvider();
        break;
      case 'none':
      default:
        _provider = new NoneKnowledgeBaseProvider();
    }
  }
  return _provider;
}

// Exported for testing
export function resetKnowledgeBaseProvider(): void {
  _provider = null;
}
