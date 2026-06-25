import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { findRepoRoot } from './utils/find-repo-root';

const REPO_ROOT = findRepoRoot(__dirname);

// Load .env from root directory
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Logger from './utils/logger';
import { appConfig } from './config/app-config';
import prdRoutes from './routes/prd-routes';
import configRoutes from './routes/config-routes';
import contextRoutes from './routes/context-routes';
import initiativesRoutes from './routes/initiatives-routes';
import { workflowRoutes } from './routes/workflow-routes';
import { workflowExportRoutes } from './routes/workflow-export-routes';
import { workflowCoordinatorRoutes } from './routes/workflow-coordinator-routes';
import { workflowQueryRoutes } from './routes/workflow-query-routes';
import { changeRequestRoutes } from './routes/change-request-routes';
import { contextDiffRouter } from './routes/context-diff-routes';
import { contextFileRouter } from './routes/context-file-routes';
import { behaviourFileRouter } from './routes/behaviour-file-routes';
import { kbRouter } from './routes/kb-routes';
import { discoveryRoutes } from './routes/discovery-routes';
import { prototypeRoutes } from './routes/prototype-routes';
import { ticketRoutes } from './routes/ticket-routes';
import { skillRoutes } from './routes/skill-routes';
import { demoWebhookRoutes } from './routes/demo-webhook-routes';
import settingsRoutes from './routes/settings-routes';
import authRoutes from './routes/auth-routes';
import userRoutes from './routes/user-routes';
import completedInitiativesRoutes from './routes/completed-initiatives-routes';
import { authMiddleware } from './middleware/auth';

const logger = new Logger('SERVER');

const app = express();
const PORT = process.env.PORT || 3001;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Built frontend assets (npm run build --workspace=app/frontend).
const FRONTEND_DIST = path.join(REPO_ROOT, 'app/frontend/dist');

// Security middleware. Helmet's defaults assume HTTPS — `upgrade-insecure-requests` rewrites
// every same-page http:// asset request to https://, and HSTS pins the host to https for
// future visits. Both break the plain-HTTP internal deployment this app also runs in (see
// docs/setup/windows-server-deployment.md): the browser ends up requesting CSS/JS over https
// against a server that only ever listens on http, failing with ERR_SSL_PROTOCOL_ERROR /
// ERR_CONNECTION_RESET and leaving a blank page. Disable both; everything else stays default.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'upgrade-insecure-requests': null,
    },
  },
  hsts: false,
}));
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

// Request size limits — generous for pipeline media uploads (base64 videos can be large)
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Serve the built frontend (single-port production deployment). No-ops in dev, where
// FRONTEND_DIST doesn't exist and the frontend is served separately by Vite.
app.use(express.static(FRONTEND_DIST));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Auth routes — always public (no authMiddleware here)
app.use('/api/auth', authRoutes);

// Protected API routes — apply auth middleware globally
app.use('/api', authMiddleware);

// API routes
app.use('/api/prd', prdRoutes);
app.use('/api/users', userRoutes);
app.use('/api/config', configRoutes);
app.use('/api/context', contextRoutes);
app.use('/api/initiatives', initiativesRoutes);
app.use('/api/discovery', discoveryRoutes);
// Workflow routes — gated by ENABLE_WORKFLOW_MODE flag (default: enabled)
if (appConfig.features.workflowModeEnabled) {
  app.use('/api/workflow', workflowRoutes);
  app.use('/api/workflow', workflowExportRoutes);
  app.use('/api/workflow', workflowCoordinatorRoutes);
  app.use('/api/workflow', workflowQueryRoutes);
} else {
  app.use('/api/workflow', (_req, res) => {
    res.status(404).json({ error: 'Workflow mode is not enabled' });
  });
}
app.use('/api', changeRequestRoutes);
app.use('/api/context-diffs', contextDiffRouter);
app.use('/api/context-files', contextFileRouter);
app.use('/api/behaviour-files', behaviourFileRouter);
app.use('/api/kb', kbRouter);
app.use('/api', prototypeRoutes);
app.use('/api', ticketRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api', demoWebhookRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/completed-initiatives', completedInitiativesRoutes);

app.get('/api', (req, res) => {
  res.json({
    message: 'Product Automation Pipeline API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      workflow: 'POST /api/workflow/*',
      initiatives: 'GET /api/initiatives',
      contextDiffs: 'GET /api/context-diffs/*',
      contextFiles: 'GET /api/context-files',
      behaviourFiles: 'GET /api/behaviour-files',
    },
  });
});

// SPA fallback — serves the frontend's index.html for any other GET so client-side
// routes resolve on a hard refresh or direct navigation (e.g. /workflow/123). Falls
// through to the 404 handler below in dev, where there's no build to serve.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'), (err) => {
    if (err) next();
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
const httpServer = http.createServer(app);

httpServer.listen(PORT, () => {
  const models = appConfig.ai.models.map(m => m.id).join(', ');
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
  logger.info(`📡 CORS enabled for: ${FRONTEND_URL}`);
  logger.info(`🌍 Environment: ${appConfig.server.nodeEnv}`);
  logger.info(`🤖 AI provider: ${appConfig.ai.provider} | models: ${models}`);
  logger.info(`\n✅ APIs ready!`);
});

export default app;
