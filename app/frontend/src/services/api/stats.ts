import axios from 'axios';
import { API_BASE_URL } from './base';

export interface StatsWeeklyPoint { weekStart: number; avg: number | null; median: number | null; count: number }

export interface StatsDashboard {
  generatedAt: number;
  rangeDays: number;
  isDemo: boolean;
  wip: { active: number; oldestActiveAgeDays: number | null };
  cycleTime: { points: StatsWeeklyPoint[]; overallAvgDays: number | null; overallMedianDays: number | null; count: number };
  timeToShip: { points: StatsWeeklyPoint[]; overallAvgDays: number | null; overallMedianDays: number | null; shippedCount: number; completedCount: number };
  firstTimeApproval: {
    points: Array<{ weekStart: number; rate: number; count: number }>;
    overallRate: number | null;
    totalDecisions: number;
    byStage: Array<{ stage: string; firstTimeApprovalRate: number; revisionRate: number; attempts: number }>;
  };
  rejectionRate: { overallRate: number | null; totalResolved: number };
  throughput: { points: Array<{ weekStart: number; started: number; completed: number }> };
  bottlenecks: {
    stageDurations: Array<{ stage: string; attempts: number; avgDwellHours: number; medianDwellHours: number; avgHumanWaitHours: number | null; avgLlmSeconds: number | null }>;
    stuckNow: Array<{
      checkpointId: number; workflowId: string; itemId: string; itemTitle: string; stage: string;
      requiredRoles: string[]; pendingSince: number; hoursPending: number; thresholdHours: number;
    }>;
  };
  qualityRegression: { completedWithChangeRequest: number; completedTotal: number; rate: number | null };
  retries: {
    totalCount: number;
    byStage: Array<{ stage: string; count: number }>;
    recent: Array<{ workflowId: string; itemId: string; itemTitle: string; stage: string; ts: number; triggeredByName: string | null }>;
  };
}

export const statsApi = {
  async getStatsDashboard(days = 90, demo = false): Promise<StatsDashboard> {
    const response = await axios.get(`${API_BASE_URL}/api/stats/dashboard`, { params: { days, demo: demo || undefined } });
    return response.data;
  },
};
