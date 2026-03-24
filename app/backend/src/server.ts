import dotenv from 'dotenv';
import path from 'path';
import express from 'express';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Logger from './utils/logger';
import { appConfig } from './config/app-config';
import prdRoutes from './routes/prd-routes';
import configRoutes from './routes/config-routes';
import decisionLogRoutes from './routes/decision-log-routes';
import contextRoutes from './routes/context-routes';
import initiativesRoutes from './routes/initiatives-routes';
import { workflowRouter } from './routes/workflow-router';
import { workflowRoutes } from './routes/workflow-routes';
import { changeRequestRoutes } from './routes/change-request-routes';
import { contextDiffRouter } from './routes/context-diff-routes';
import { contextFileRouter } from './routes/context-file-routes';
import { templateFileRouter } from './routes/template-file-routes';
import { prototypeRoutes } from './routes/prototype-routes';

const logger = new Logger('SERVER');

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests from localhost, file://, and the frontend URL
    const allowedOrigins = [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001'];
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('file://')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for development
    }
  },
  credentials: true,
}));

// Rate limiting — generous limit for single-user local tool.
// Polling endpoints (events, status) fire every 2s and would exhaust a tight cap.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  skip: (req) => {
    // Exempt high-frequency polling endpoints from rate limiting
    return /\/api\/workflow\/[^/]+\/(events|status)/.test(req.originalUrl);
  },
});
app.use('/api/', limiter);

// Request size limits
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api/prd', prdRoutes);
app.use('/api/config', configRoutes);
app.use('/api/decision-log', decisionLogRoutes);
app.use('/api/context', contextRoutes);
app.use('/api/initiatives', initiativesRoutes);
// Workflow routes — gated by ENABLE_WORKFLOW_MODE flag (default: enabled)
if (appConfig.features.workflowModeEnabled) {
  app.use('/api/workflows', workflowRouter);
  app.use('/api/workflow', workflowRoutes);
} else {
  app.use(['/api/workflows', '/api/workflow'], (_req, res) => {
    res.status(404).json({ error: 'Workflow mode is not enabled' });
  });
}
app.use('/api', changeRequestRoutes);
app.use('/api/context-diffs', contextDiffRouter);
app.use('/api/context-files', contextFileRouter);
app.use('/api/template-files', templateFileRouter);
app.use('/api', prototypeRoutes);

app.get('/api', (req, res) => {
  res.json({
    message: 'Product Automation Pipeline API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      bmad: {
        start: 'POST /api/bmad/start',
        menuSelect: 'POST /api/bmad/menu-select',
        message: 'POST /api/bmad/message (SSE)',
        export: 'POST /api/bmad/export',
        session: 'GET /api/bmad/session/:sessionId',
        deleteSession: 'DELETE /api/bmad/session/:sessionId',
      },
      airtable: {
        items: 'GET /api/prd/items/needingPRD',
      },
    },
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(err.statusCode || 500).json({
    error: err.message || 'Internal server error',
    ...(appConfig.server.nodeEnv === 'development' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// Start server
app.listen(PORT, () => {
  const models = appConfig.ai.models.map(m => m.id).join(', ');
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
  logger.info(`📡 CORS enabled for: ${FRONTEND_URL}`);
  logger.info(`🌍 Environment: ${appConfig.server.nodeEnv}`);
  logger.info(`🤖 AI provider: ${appConfig.ai.provider} | models: ${models}`);
  logger.info(`\n✅ BMAD Agent APIs ready!`);
  logger.info(`📋 BMAD Endpoints:`);
  logger.info(`   POST /api/bmad/start - Start BMAD session (PRD/Backlog/Analyst)`);
  logger.info(`   POST /api/bmad/menu-select - Select workflow from agent menu`);
  logger.info(`   POST /api/bmad/message - Chat with agent (SSE streaming)`);
  logger.info(`   POST /api/prd/publish - Publish PRD to local file`);
  logger.info(`   POST /api/bmad/publish-backlog - Save backlog as local JSON file\n`);
});

export default app;
