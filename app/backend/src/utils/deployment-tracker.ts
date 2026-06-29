/**
 * Deployment tracking: records each server start with version info
 * for operational visibility and rollback tracking.
 */
import db from '../data/database';
import Logger from './logger';
import os from 'os';

const logger = new Logger('DEPLOYMENT');

interface DeploymentRecord {
  version: string;
  commit_hash?: string;
  commit_short?: string;
  branch?: string;
  tag?: string;
  is_dirty?: number;
  build_time?: string;
  deployed_by?: string;
  node_version: string;
  environment: string;
}

/**
 * Record this deployment in the database.
 * Called once on server startup.
 */
export function recordDeployment(): void {
  try {
    let versionData: any = null;
    try {
      versionData = require('../version.json');
    } catch {
      logger.warn('version.json not found - recording deployment without version info');
    }

    const record: DeploymentRecord = {
      version: versionData?.version || 'unknown',
      commit_hash: versionData?.git?.commit,
      commit_short: versionData?.git?.commitShort,
      branch: versionData?.git?.branch,
      tag: versionData?.git?.tag,
      is_dirty: versionData?.git?.isDirty ? 1 : 0,
      build_time: versionData?.buildTime,
      deployed_by: process.env.USER || process.env.USERNAME || os.userInfo().username,
      node_version: process.version,
      environment: process.env.NODE_ENV || 'production',
    };

    const stmt = db.prepare(`
      INSERT INTO deployments (
        version, commit_hash, commit_short, branch, tag, is_dirty,
        build_time, deployed_at, deployed_by, node_version, environment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.version,
      record.commit_hash || null,
      record.commit_short || null,
      record.branch || null,
      record.tag || null,
      record.is_dirty || 0,
      record.build_time || null,
      Date.now(),
      record.deployed_by,
      record.node_version,
      record.environment
    );

    logger.info(`Recorded deployment: ${record.version} (${record.commit_short || 'unknown'}) by ${record.deployed_by}`);
  } catch (error: any) {
    logger.error('Failed to record deployment', error);
    // Non-fatal - don't crash the server over deployment tracking
  }
}

/**
 * Get recent deployments for operational visibility.
 */
export function getRecentDeployments(limit: number = 10) {
  const stmt = db.prepare(`
    SELECT * FROM deployments
    ORDER BY deployed_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

/**
 * Get the current deployed version (most recent deployment record).
 */
export function getCurrentDeployment() {
  const stmt = db.prepare(`
    SELECT * FROM deployments
    ORDER BY deployed_at DESC
    LIMIT 1
  `);
  return stmt.get();
}
