/**
 * Public API client facade. The implementation is split into domain modules under
 * services/api/*; this file composes them into the single `api` singleton that the
 * rest of the app calls as `api.<method>()`. Add a new endpoint by extending the
 * relevant domain module (or adding a new one and spreading it below).
 */
import { configApi } from './api/config';
import { initiativesApi } from './api/initiatives';
import { decisionLogApi } from './api/decision-log';
import { workflowApi } from './api/workflow';
import { changeRequestApi } from './api/change-request';
import { contextApi } from './api/context';
import { skillsApi } from './api/skills';
import { prototypeApi } from './api/prototype';
import { ticketsApi } from './api/tickets';
import { demoApi } from './api/demo';
import { usersApi } from './api/users';
import { discoveryApi } from './api/discovery';
import { statsApi } from './api/stats';

export type { SkillVersion } from './api/types';
export type { StatsDashboard } from './api/stats';

export const api = {
  ...configApi,
  ...initiativesApi,
  ...decisionLogApi,
  ...workflowApi,
  ...changeRequestApi,
  ...contextApi,
  ...skillsApi,
  ...prototypeApi,
  ...ticketsApi,
  ...demoApi,
  ...usersApi,
  ...discoveryApi,
  ...statsApi,
};
