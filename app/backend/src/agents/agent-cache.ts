import { AgentType } from '@pap/shared';
import { SpecialistAgent } from './specialist-agent';
import Logger from '../utils/logger';

const logger = new Logger('AGENT-CACHE');

/**
 * Module-level cache of SpecialistAgent instances, keyed by AgentType.
 * Shared across route files so that
 * clearAllContextCaches() invalidates the project context on every agent.
 */
export const agentCache: Map<AgentType, SpecialistAgent> = new Map();

export async function getOrCreateAgent(agentType: AgentType): Promise<SpecialistAgent> {
  if (!agentCache.has(agentType)) {
    const agent = new SpecialistAgent(agentType);
    await agent.loadPersona();
    agentCache.set(agentType, agent);
  }
  return agentCache.get(agentType)!;
}

/**
 * Invalidate the in-memory project context cache on ALL cached agents.
 * Call after writing any context/*.md file so the next AI request
 * picks up the updated content without a server restart.
 */
export function clearAllContextCaches(): void {
  for (const agent of agentCache.values()) {
    agent.clearContextCache();
  }
  logger.info(`Cleared project context cache on ${agentCache.size} cached agent(s)`);
}
