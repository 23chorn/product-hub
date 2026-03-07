import { Session, ChatMessage, PRDContent, BacklogStructure, AgentType, AppMode, QuickItem } from '@pap/shared';
import { sessionStore } from '../data/session-store';
import Logger from '../utils/logger';

const logger = new Logger('SESSION-MANAGER');

/** Derive agent_id string from mode per spec convention. */
function deriveAgentId(mode: AppMode, agentType: AgentType): string {
  if (agentType === 'analyst') return 'analyst';
  if (agentType === 'decision-log') return 'decision-log';
  return `pm-${mode}`; // 'pm-prd' | 'pm-backlog'
}

/**
 * Session manager that delegates to SQLite-backed SessionStore.
 */
export class SessionManager {

  /**
   * Create a new session (legacy signature for prd-routes/backlog-routes)
   */
  createSession(itemId: string, type: 'prd' | 'backlog'): Session {
    const agentType: AgentType = 'pm';
    const mode: AppMode = type;
    const agentId = deriveAgentId(mode, agentType);
    return sessionStore.createSession(itemId, mode, agentId);
  }

  /**
   * Create a new BMAD session.
   * Ensures an item row exists in the items table before creating the session.
   * For Airtable items, upserts using the Airtable record ID.
   * For quick_add items, the row already exists — no upsert needed.
   */
  createBmadSession(itemId: string, mode: AppMode, agentType: AgentType, itemTitle?: string): Session {
    const source = sessionStore.getItemSource(itemId);
    if (!source) {
      // Unknown item — assume Airtable item and upsert
      sessionStore.upsertItem(itemId, itemTitle || itemId, 'airtable', itemId);
    }
    // 'quick_add' items already exist in DB — no upsert needed
    const agentId = deriveAgentId(mode, agentType);
    return sessionStore.createSession(itemId, mode, agentId);
  }

  /**
   * Find an active session for item + mode (for resume)
   */
  findActiveSession(itemId: string, mode: AppMode): Session | null {
    return sessionStore.findActiveSession(itemId, mode);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return sessionStore.getSession(sessionId);
  }

  /**
   * Add a message to a session
   */
  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    sessionStore.addMessage(sessionId, role, content);
  }

  /**
   * Get all messages in a session
   */
  getMessages(sessionId: string): ChatMessage[] {
    return sessionStore.getMessages(sessionId);
  }

  /**
   * Update session workflow state
   */
  updateWorkflow(sessionId: string, activeWorkflow: string | undefined, workflowContext: string | undefined): void {
    sessionStore.updateWorkflow(sessionId, activeWorkflow, workflowContext);
  }

  /**
   * Update conversation file path
   */
  updateConversationPath(sessionId: string, conversationPath: string): void {
    sessionStore.updateConversationPath(sessionId, conversationPath);
  }

  /**
   * Update PRD content in session
   */
  updatePRDContent(sessionId: string, prdContent: PRDContent): void {
    const session = sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    logger.info(`Updated PRD content for session ${sessionId}`);
  }

  /**
   * Update backlog structure in session
   */
  updateBacklogStructure(sessionId: string, backlogStructure: BacklogStructure): void {
    const session = sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    logger.info(`Updated backlog structure for session ${sessionId}`);
  }

  /**
   * Mark session as completed
   */
  completeSession(sessionId: string): void {
    sessionStore.completeSession(sessionId);
  }

  /**
   * Hard reset: delete session and all related data
   */
  deleteSession(sessionId: string): void {
    sessionStore.deleteSession(sessionId);
  }

  /**
   * Add an artifact reference
   */
  addArtifact(sessionId: string, type: string, filePath: string): void {
    sessionStore.addArtifact(sessionId, type, filePath);
  }

  /**
   * Get artifacts for a session (most recent first)
   */
  getArtifacts(sessionId: string): Array<{ type: string; filePath: string; createdAt: number }> {
    return sessionStore.getArtifacts(sessionId);
  }

  /**
   * Get the file path of the most recently exported PRD artifact for an item.
   */
  getLatestPrdArtifactPath(itemId: string): string | null {
    return sessionStore.getLatestPrdArtifactPath(itemId);
  }

  /**
   * Get the file path of the most recently exported analyst research report for an item.
   */
  getLatestAnalystArtifactPath(itemId: string): string | null {
    return sessionStore.getLatestAnalystArtifactPath(itemId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    return sessionStore.getActiveSessions();
  }

  /**
   * Get sessions by item ID
   */
  getSessionsByItem(itemId: string): Session[] {
    return sessionStore.getSessionsByItem(itemId);
  }

  /**
   * Get session statistics
   */
  getStats() {
    return sessionStore.getStats();
  }

  // ---------------------------------------------------------------------------
  // Quick Items
  // ---------------------------------------------------------------------------

  getQuickItems(): QuickItem[] {
    return sessionStore.getQuickItems();
  }

  countQuickItems(): number {
    return sessionStore.countQuickItems();
  }

  createQuickItem(): QuickItem {
    return sessionStore.createQuickItem();
  }

  deleteQuickItem(itemId: string): boolean {
    return sessionStore.deleteQuickItem(itemId);
  }

  getItemSource(itemId: string): string | null {
    return sessionStore.getItemSource(itemId);
  }

  getItemTitle(itemId: string): string | null {
    return sessionStore.getItemTitle(itemId);
  }

  getSessionIdsByItem(itemId: string): Array<{ id: string; mode: string }> {
    return sessionStore.getSessionIdsByItem(itemId);
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
