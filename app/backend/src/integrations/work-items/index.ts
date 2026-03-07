import { WorkItemProvider } from '@pap/shared';
import { appConfig } from '../../config/app-config';
import { NoneWorkItemProvider } from './none';
import { AdoWorkItemProvider } from './ado';
import { JiraWorkItemProvider } from './jira';

let _provider: WorkItemProvider | null = null;

export function getWorkItemProvider(): WorkItemProvider {
  if (!_provider) {
    switch (appConfig.integrations.workItems) {
      case 'ado':
        _provider = new AdoWorkItemProvider();
        break;
      case 'jira':
        _provider = new JiraWorkItemProvider();
        break;
      case 'none':
      default:
        _provider = new NoneWorkItemProvider();
    }
  }
  return _provider;
}

// Exported for testing
export function resetWorkItemProvider(): void {
  _provider = null;
}
