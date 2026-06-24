/**
 * Public API client facade. The implementation is split into domain modules under
 * services/api/*; this file composes them into the single `api` singleton that the
 * rest of the app calls as `api.<method>()`. Add a new endpoint by extending the
 * relevant domain module (or adding a new one and spreading it below).
 */
import { configApi } from './api/config';
import { initiativesApi } from './api/initiatives';
import { workflowApi } from './api/workflow';
import { changeRequestApi } from './api/change-request';
import { contextApi } from './api/context';
import { skillsApi } from './api/skills';
import { prototypeApi } from './api/prototype';
import { ticketsApi } from './api/tickets';
import { demoApi } from './api/demo';
import { usersApi } from './api/users';
import { discoveryApi } from './api/discovery';
import { kbApi } from './api/kb';
import { completedInitiativesApi } from './api/completed-initiatives';

export type { AgentFile, AgentFileContent } from './api/types';

export const api = {
  ...configApi,
  ...initiativesApi,
  ...workflowApi,
  ...changeRequestApi,
  ...contextApi,
  ...skillsApi,
  ...prototypeApi,
  ...ticketsApi,
  ...demoApi,
  ...usersApi,
  ...discoveryApi,
  ...kbApi,
  ...completedInitiativesApi,
};
