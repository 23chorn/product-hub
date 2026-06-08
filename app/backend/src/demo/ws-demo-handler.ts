import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

export interface DemoEvent {
  type: string;
  label: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

const FIXTURE_THEME = process.env.DEMO_FIXTURE_THEME ?? 'price-alerts';

const MOCK_AIRTABLE_WEBHOOK = FIXTURE_THEME === 'messaging' ? {
  type: 'record.created',
  table: 'Initiatives',
  timestamp: new Date().toISOString(),
  record: {
    id: 'recMSG456ABC',
    fields: {
      Initiative: 'In-App Messaging & Trade Chat — TradeEasy',
      Description:
        'Add real-time channel-based chat so users can discuss trades without leaving the app. Topic channels (e.g. #aapl-watchers), live ticker card sharing, MiFID II-compliant message retention.',
      Priority: 'High',
      Team: 'Platform',
      Sprint: 'Q2 2026',
      BusinessValue: 9,
      Estimate: 'L',
    },
  },
} : {
  type: 'record.created',
  table: 'Initiatives',
  timestamp: new Date().toISOString(),
  record: {
    id: 'recABC123XYZ',
    fields: {
      Initiative: 'Price Alerts & Watchlist — TradeEasy',
      Description:
        'Build a price alert and notification system for retail investors. Users can set price alerts (above/below threshold) on any tradable instrument. Push notifications delivered within 30 seconds of the trigger price being hit.',
      Priority: 'High',
      Team: 'Mobile Platform',
      Sprint: 'Q1 2026',
      BusinessValue: 8,
      Estimate: 'M',
    },
  },
};

const CODE_LINES = FIXTURE_THEME === 'messaging' ? [
  "import { WebSocket } from 'ws';",
  "import { CassandraClient } from './db/CassandraClient';",
  "import { RedisPublisher } from './pubsub/RedisPublisher';",
  "import { ModerationService } from './ModerationService';",
  '',
  'export interface Message {',
  '  messageId: string;',
  '  channelId: string;',
  '  userId: string;',
  '  content: string;',
  '  tickerRef?: { symbol: string };',
  '  moderationStatus: string;',
  '  createdAt: Date;',
  '}',
  '',
  'export class MessageService {',
  '  constructor(',
  '    private cassandra: CassandraClient,',
  '    private redis: RedisPublisher,',
  '    private moderation: ModerationService,',
  '  ) {}',
  '',
  '  async send(params: Omit<Message, "messageId" | "createdAt" | "moderationStatus">): Promise<Message> {',
  '    // Stage 1: synchronous rule-based check < 5ms',
  '    const ruleResult = await this.moderation.checkRules(params);',
  '    if (ruleResult.blocked) {',
  "      return { ...params, messageId: crypto.randomUUID(), moderationStatus: 'held', createdAt: new Date() };",
  '    }',
  '',
  '    const message: Message = {',
  '      ...params,',
  '      messageId: crypto.randomUUID(),',
  "      moderationStatus: 'approved',",
  '      createdAt: new Date(),',
  '    };',
  '',
  '    // Write to Cassandra before fan-out',
  '    await this.cassandra.execute(',
  "      'INSERT INTO messages (channel_id, created_at, message_id, user_id, content, ticker_ref, moderation_status) VALUES (?, ?, ?, ?, ?, ?, ?)',",
  '      [message.channelId, message.createdAt, message.messageId, message.userId, message.content, JSON.stringify(message.tickerRef ?? null), message.moderationStatus]',
  '    );',
  '',
  '    // Fan out to all channel subscribers via Redis Pub/Sub',
  '    await this.redis.publish(`ch:${message.channelId}`, JSON.stringify(message));',
  '',
  '    // Stage 2: async LLM moderation (non-blocking)',
  '    this.moderation.classifyAsync(message).catch(console.error);',
  '',
  '    return message;',
  '  }',
  '}',
] : [
  "import { EventEmitter } from 'events';",
  "import { WebSocketPriceFeed } from './WebSocketPriceFeed';",
  "import { NotificationService } from './NotificationService';",
  "import { AlertRepository } from '../repositories/AlertRepository';",
  '',
  'export interface PriceAlert {',
  '  id: string;',
  '  userId: string;',
  '  symbol: string;',
  '  targetPrice: number;',
  "  direction: 'above' | 'below';",
  '  createdAt: Date;',
  '  triggered: boolean;',
  '}',
  '',
  'export class PriceAlertService extends EventEmitter {',
  '  private alerts = new Map<string, PriceAlert[]>();',
  '',
  '  constructor(',
  '    private priceFeed: WebSocketPriceFeed,',
  '    private notifications: NotificationService,',
  '    private repository: AlertRepository,',
  '  ) {',
  '    super();',
  "    this.priceFeed.on('price', this.handlePriceUpdate.bind(this));",
  '  }',
  '',
  '  async createAlert(',
  "    params: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered'>",
  '  ): Promise<PriceAlert> {',
  '    const alert: PriceAlert = {',
  '      ...params,',
  '      id: crypto.randomUUID(),',
  '      createdAt: new Date(),',
  '      triggered: false,',
  '    };',
  '    await this.repository.save(alert);',
  '    const existing = this.alerts.get(params.symbol) ?? [];',
  '    this.alerts.set(params.symbol, [...existing, alert]);',
  '    this.priceFeed.subscribe(params.symbol);',
  '    return alert;',
  '  }',
  '',
  '  private async handlePriceUpdate(symbol: string, price: number) {',
  '    const symbolAlerts = this.alerts.get(symbol) ?? [];',
  '    for (const alert of symbolAlerts.filter(a => !a.triggered)) {',
  '      const triggered =',
  '        (alert.direction === "above" && price >= alert.targetPrice) ||',
  '        (alert.direction === "below" && price <= alert.targetPrice);',
  '      if (!triggered) continue;',
  '      alert.triggered = true;',
  '      await this.repository.markTriggered(alert.id);',
  '      await this.notifications.send({',
  '        userId: alert.userId,',
  '        title: `${symbol} price alert`,',
  '        body: `${symbol} is now $${price.toFixed(2)}`,',
  '        data: { alertId: alert.id, symbol, price },',
  '      });',
  "      this.emit('alert:triggered', alert, price);",
  '    }',
  '  }',
  '}',
];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function send(ws: WebSocket, event: DemoEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

async function runDemoSequence(ws: WebSocket) {
  const now = () => Date.now();

  send(ws, {
    type: 'demo_started',
    label: 'Demo sequence initialised',
    timestamp: now(),
  });

  await sleep(600);
  send(ws, {
    type: 'airtable_webhook',
    label: 'Airtable webhook received',
    timestamp: now(),
    payload: MOCK_AIRTABLE_WEBHOOK,
  });

  await sleep(900);
  send(ws, {
    type: 'initiative_parsed',
    label: 'Initiative parsed from webhook payload',
    timestamp: now(),
    payload: {
      initiative: MOCK_AIRTABLE_WEBHOOK.record.fields.Initiative,
      priority: MOCK_AIRTABLE_WEBHOOK.record.fields.Priority,
      team: MOCK_AIRTABLE_WEBHOOK.record.fields.Team,
      estimate: MOCK_AIRTABLE_WEBHOOK.record.fields.Estimate,
    },
  });

  await sleep(1000);
  send(ws, {
    type: 'hub_intake',
    label: 'Product Hub — intake started',
    timestamp: now(),
    payload: { message: 'Coordinator reading company.md, strategy.md, current-state.md…' },
  });

  await sleep(1400);
  send(ws, {
    type: 'coordinator_analyzing',
    label: 'Coordinator analysing requirements',
    timestamp: now(),
    payload: {
      stages: ['analyst', 'pm_prd', 'solution_architect', 'pm_backlog'],
      message: 'Selecting pipeline stages based on scope and constraints…',
    },
  });

  await sleep(1600);
  send(ws, {
    type: 'workflow_started',
    label: 'Workflow started — 4 stages queued',
    timestamp: now(),
    payload: { workflowId: 'wf_demo_' + Math.random().toString(36).slice(2, 8) },
  });

  await sleep(1200);
  send(ws, {
    type: 'ado_pipeline_queued',
    label: 'Azure DevOps pipeline queued',
    timestamp: now(),
    payload: {
      pipeline: 'PRD-to-Backlog-Sync',
      project: 'TradeEasy',
      queue: 'Default',
    },
  });

  await sleep(1000);
  send(ws, {
    type: 'ado_pipeline_triggered',
    label: 'Pipeline run #4821 triggered',
    timestamp: now(),
    payload: {
      runId: 4821,
      url: 'https://dev.azure.com/tradeeasy/mobile/_build/results?buildId=4821',
      status: 'inProgress',
    },
  });

  await sleep(1400);
  send(ws, {
    type: 'ado_creating_items',
    label: 'Creating ADO work items — Epic → Features → Stories',
    timestamp: now(),
    payload: FIXTURE_THEME === 'messaging' ? {
      epic: 'In-App Messaging & Trade Chat',
      features: ['Channel Discovery & Membership', 'Real-Time Messaging', 'Content Moderation & Compliance'],
      storiesTotal: 8,
    } : {
      epic: 'Price Alerts & Watchlist',
      features: ['Alert Configuration', 'Push Notification Delivery', 'Alert History & Management'],
      storiesTotal: 12,
    },
  });

  // Start code generation at same time as ADO item creation
  await sleep(400);
  send(ws, {
    type: 'code_generation_start',
    label: 'Claude Code — generating PriceAlertService.ts',
    timestamp: now(),
    payload: FIXTURE_THEME === 'messaging'
      ? { file: 'src/services/MessageService.ts', ticket: 'F2.S1' }
      : { file: 'src/services/PriceAlertService.ts', ticket: 'F1.S1' },
  });

  // Stream code lines
  for (const line of CODE_LINES) {
    if (ws.readyState !== WebSocket.OPEN) break;
    send(ws, {
      type: 'code_line',
      label: line,
      timestamp: now(),
    });
    await sleep(line.length > 0 ? 80 + Math.random() * 60 : 40);
  }

  await sleep(500);
  send(ws, {
    type: 'ado_sync_complete',
    label: 'ADO sync complete',
    timestamp: now(),
    payload: { created: 16, updated: 0, epics: 1, features: 3, stories: 12 },
  });

  await sleep(400);
  send(ws, {
    type: 'code_generation_complete',
    label: 'PriceAlertService.ts — generation complete',
    timestamp: now(),
    payload: { lines: CODE_LINES.length, file: FIXTURE_THEME === 'messaging' ? 'src/services/MessageService.ts' : 'src/services/PriceAlertService.ts' },
  });

  await sleep(300);
  send(ws, {
    type: 'demo_complete',
    label: 'Demo sequence complete',
    timestamp: now(),
    payload: { totalMs: 12000 },
  });
}

export function attachDemoWebSocket(_server: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('error', (err) => {
    console.error('[WS-DEMO] WebSocketServer error:', err.message);
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    send(ws, {
      type: 'connected',
      label: 'WebSocket connected — ready for demo',
      timestamp: Date.now(),
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'trigger_demo') {
          runDemoSequence(ws).catch(() => {});
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  return wss;
}
