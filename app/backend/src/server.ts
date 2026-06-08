import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
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
import { prototypeRoutes } from './routes/prototype-routes';
import { ticketRoutes } from './routes/ticket-routes';
import { skillRoutes } from './routes/skill-routes';
import { personaRoutes } from './routes/persona-routes';
import { seedSkills, syncSeedSkillTools } from './agents/skill-registry';
import { attachDemoWebSocket } from './demo/ws-demo-handler';
import { attachAiCodingWebSocket } from './demo/ws-ai-coding-handler';
import { aiCodingRoutes } from './routes/ai-coding-routes';
import { demoWebhookRoutes } from './routes/demo-webhook-routes';
import { demoProjectRoutes } from './routes/demo-project-routes';

const logger = new Logger('SERVER');

const app = express();
const PORT = process.env.PORT || 3001;

seedSkills();
syncSeedSkillTools();
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
app.use('/api', prototypeRoutes);
app.use('/api', ticketRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/agents/personas', personaRoutes);
app.use('/api', aiCodingRoutes);
app.use('/api', demoWebhookRoutes);
app.use('/api', demoProjectRoutes);

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
const httpServer = http.createServer(app);
const demoWss = attachDemoWebSocket(httpServer);
const aiCodingWss = attachAiCodingWebSocket(httpServer);

// Route WebSocket upgrades by path — multiple WSS on one server requires manual routing
// because the ws package destroys the socket if a path doesn't match, blocking other handlers.
httpServer.on('upgrade', (req, socket, head) => {
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname === '/ws/demo') {
    demoWss.handleUpgrade(req, socket, head, (ws) => demoWss.emit('connection', ws, req));
  } else if (pathname === '/ws/ai-coding') {
    aiCodingWss.handleUpgrade(req, socket, head, (ws) => aiCodingWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  const models = appConfig.ai.models.map(m => m.id).join(', ');
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
  logger.info(`📡 CORS enabled for: ${FRONTEND_URL}`);
  logger.info(`🌍 Environment: ${appConfig.server.nodeEnv}`);
  logger.info(`🤖 AI provider: ${appConfig.ai.provider} | models: ${models}`);
  logger.info(`🔌 WebSocket demo available at ws://localhost:${PORT}/ws/demo`);
  logger.info(`💻 AI Coding WebSocket at ws://localhost:${PORT}/ws/ai-coding`);
  logger.info(`\n✅ APIs ready!`);
});

export default app;
