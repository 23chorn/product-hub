import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { AzureDevOpsClient } from '../integrations/azure-devops';
import type { BacklogStructure } from '@pap/shared';

export interface DemoEvent {
  type: string;
  label: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

const FIXTURE_THEME = process.env.DEMO_FIXTURE_THEME ?? 'price-alerts';

// ── ADO config from env ──────────────────────────────────────────────────────
function resolveAdoOrg(raw: string): string {
  if (raw.includes('dev.azure.com')) {
    const match = raw.match(/dev\.azure\.com\/([^/]+)/);
    return match ? match[1] : raw;
  }
  return raw;
}
const ADO_ORG = resolveAdoOrg(process.env.AZURE_DEVOPS_ORG ?? '');
const ADO_PROJECT = process.env.AZURE_DEVOPS_PROJECT ?? '';
const ADO_PAT = process.env.AZURE_DEVOPS_PAT ?? '';
const ADO_STORY_TYPE = process.env.AZURE_DEVOPS_STORY_TYPE ?? 'Product Backlog Item';
const ADO_BASE = ADO_ORG && ADO_PROJECT
  ? `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}`
  : 'https://dev.azure.com/your-org/your-project';

// ── Demo backlog fixtures (pushed to ADO when credentials are configured) ─────

const MESSAGING_BACKLOG: BacklogStructure = {
  epic: {
    title: 'In-App Messaging & Trade Chat',
    description: 'Add real-time channel-based chat so users can discuss trades without leaving the app.',
    businessValue: 'Reduce app abandonment by keeping trading discussions in-context.',
    prdLink: '',
  },
  features: [
    {
      title: 'Channel Discovery & Membership',
      description: 'Allow users to browse, create, and join topic-based chat channels.',
      phase: 'MVP',
      stories: [
        {
          title: 'User can browse and search available channels',
          persona: 'active retail trader',
          goal: 'see a list of available chat channels filtered by topic or ticker',
          benefit: 'I can quickly find relevant discussions without scrolling through everything',
          acceptanceCriteria: [
            'Given I open the channels tab, When the list loads, Then I see channels sorted by member count',
            'Given I search for a ticker, When I type "AAPL", Then channels tagged AAPL appear first',
          ],
          effort: 3,
        },
        {
          title: 'User can create a new ticker-specific channel',
          persona: 'active retail trader',
          goal: 'create a channel dedicated to a specific stock ticker',
          benefit: 'I can start focused discussions with others watching the same stock',
          acceptanceCriteria: [
            'Given I tap "New Channel", When I enter a ticker, Then a channel is created with that ticker as the tag',
            'Given a channel with the same ticker exists, When I try to create a duplicate, Then I am shown the existing channel',
          ],
          effort: 3,
        },
        {
          title: 'User can join and leave channels',
          persona: 'active retail trader',
          goal: 'join channels I am interested in and leave ones I no longer follow',
          benefit: 'My channel list stays relevant to my current watchlist',
          acceptanceCriteria: [
            'Given I view a channel, When I tap Join, Then I am added as a member and see new messages',
            'Given I am a member, When I tap Leave, Then I no longer receive notifications from that channel',
          ],
          effort: 2,
        },
      ],
    },
    {
      title: 'Real-Time Messaging',
      description: 'Enable low-latency text messaging and ticker card sharing within channels.',
      phase: 'MVP',
      stories: [
        {
          title: 'User can send and receive text messages in real time',
          persona: 'active retail trader',
          goal: 'send messages and see replies appear instantly in a channel',
          benefit: 'I can have live conversations about market moves as they happen',
          acceptanceCriteria: [
            'Given I send a message, When another user is in the channel, Then they see it within 500ms',
            'Given the app is backgrounded, When a message arrives, Then a push notification is delivered',
          ],
          effort: 5,
        },
        {
          title: 'User can share a live ticker card into a channel',
          persona: 'active retail trader',
          goal: 'share the current price and chart snapshot of a stock directly into chat',
          benefit: 'I can show exactly what price action I am referring to without switching apps',
          acceptanceCriteria: [
            'Given I am on a stock page, When I tap "Share to Chat", Then a rich ticker card is posted showing current price and 1-day chart',
            'Given a ticker card is posted, When I tap it, Then I am taken to the full stock page',
          ],
          effort: 5,
        },
      ],
    },
    {
      title: 'Content Moderation & Compliance',
      description: 'Ensure all messages meet MiFID II retention requirements and community standards.',
      phase: 'MVP',
      stories: [
        {
          title: 'System archives all messages for 7-year MiFID II retention',
          persona: 'compliance officer',
          goal: 'ensure all chat messages are stored in an immutable archive for regulatory audit',
          benefit: 'the firm meets MiFID II record-keeping obligations without manual intervention',
          acceptanceCriteria: [
            'Given a message is sent, When it is delivered, Then it is written to the compliance archive within 1 second',
            'Given 7 years have not elapsed, When an audit query is made, Then the message is retrievable',
          ],
          effort: 5,
        },
        {
          title: 'Automated moderation flags pump-and-dump signals',
          persona: 'community moderator',
          goal: 'have suspected pump-and-dump signals automatically flagged before public display',
          benefit: 'the moderation team focuses review effort on high-risk messages',
          acceptanceCriteria: [
            'Given a message contains known pump-and-dump phrases, When submitted, Then it is held for review and not shown publicly',
            'Given a message is cleared, When a moderator approves it, Then it is published with original timestamp',
          ],
          effort: 8,
        },
      ],
    },
  ],
};

const PRICE_ALERTS_BACKLOG: BacklogStructure = {
  epic: {
    title: 'Price Alerts & Watchlist',
    description: 'Allow users to set configurable price alerts and receive push notifications when conditions are met.',
    businessValue: 'Increase daily active usage by 22% through timely re-engagement. Users with alerts have 3× higher 90-day retention.',
    prdLink: '',
  },
  features: [
    {
      title: 'Alert Configuration',
      description: 'Let users create, edit, and delete price alerts with flexible conditions.',
      phase: 'MVP',
      stories: [
        {
          title: 'User can create a price alert for any instrument',
          persona: 'retail investor',
          goal: 'set a price alert so I am notified when a stock crosses a target price',
          benefit: 'I can act on trading opportunities without constantly checking the app',
          acceptanceCriteria: [
            'Given I am on a stock page, When I tap "Set Alert", Then I can enter a target price and direction (above/below)',
            'Given I save the alert, When the price already satisfies the condition, Then I see a warning before saving',
          ],
          effort: 3,
        },
        {
          title: 'User can view and edit existing alerts',
          persona: 'retail investor',
          goal: 'see all my active alerts in one place and update target prices',
          benefit: 'I can keep alerts current as my investment thesis evolves',
          acceptanceCriteria: [
            'Given I open Alerts, When it loads, Then I see each alert with ticker, condition, and target price',
            'Given I tap an alert, When I change the price and save, Then the alert updates immediately',
          ],
          effort: 2,
        },
        {
          title: 'User can delete alerts they no longer need',
          persona: 'retail investor',
          goal: 'remove alerts for positions I have closed',
          benefit: 'My alerts list stays clean and relevant',
          acceptanceCriteria: [
            'Given I swipe on an alert, When I confirm delete, Then it is removed and no further notifications are sent',
          ],
          effort: 1,
        },
      ],
    },
    {
      title: 'Push Notification Delivery',
      description: 'Deliver timely, actionable push notifications when alert conditions are met.',
      phase: 'MVP',
      stories: [
        {
          title: 'User receives push notification when price alert triggers',
          persona: 'retail investor',
          goal: 'get notified immediately when a stock hits my target price',
          benefit: 'I can take action at the right moment even when the app is in the background',
          acceptanceCriteria: [
            'Given an alert is active, When the price crosses the threshold, Then a push notification is delivered within 10 seconds',
            'Given notifications are disabled, When an alert triggers, Then an in-app badge is shown on next open',
          ],
          effort: 5,
        },
        {
          title: 'Tapping notification navigates to the triggered instrument',
          persona: 'retail investor',
          goal: 'go directly to the stock page when I tap a price alert notification',
          benefit: 'I can review the chart and act in one tap',
          acceptanceCriteria: [
            'Given I receive an alert notification, When I tap it, Then I am taken to the instrument page',
            'Given the app is closed, When I tap the notification, Then the app opens on the instrument page directly',
          ],
          effort: 2,
        },
      ],
    },
    {
      title: 'Alert History & Management',
      description: 'Provide visibility into triggered alerts and bulk management actions.',
      phase: 'MVP',
      stories: [
        {
          title: 'User can view history of triggered alerts',
          persona: 'retail investor',
          goal: 'review which alerts triggered in the past 30 days',
          benefit: 'I can track whether my price targets were accurate',
          acceptanceCriteria: [
            'Given I open Alert History, When it loads, Then I see triggered alerts sorted by most recent with ticker, price, and time',
          ],
          effort: 3,
        },
        {
          title: 'User can clear triggered alerts in bulk',
          persona: 'retail investor',
          goal: 'dismiss multiple triggered alerts at once',
          benefit: 'I spend less time on housekeeping and more time on analysis',
          acceptanceCriteria: [
            'Given I tap "Clear triggered", When confirmed, Then all triggered alerts are removed in one action',
            'Given I accidentally clear alerts, When I undo within 5 seconds, Then the alerts are restored',
          ],
          effort: 2,
        },
      ],
    },
  ],
};

// ── Real ADO ticket creation ───────────────────────────────────────────────────

async function createDemoAdoItems(): Promise<{ epicId: number; featureCount: number; storyCount: number } | null> {
  try {
    const backlog = FIXTURE_THEME === 'messaging' ? MESSAGING_BACKLOG : PRICE_ALERTS_BACKLOG;
    const client = new AzureDevOpsClient();
    const result = await client.createBacklog(backlog);
    return {
      epicId: result.epicId,
      featureCount: result.featureIds.length,
      storyCount: result.storyIds.length,
    };
  } catch (err: any) {
    console.error(`[WS-DEMO] ADO item creation failed: ${err.message}`);
    return null;
  }
}

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
      stages: ['analyst', 'pm_prd', 'solution_architect', 'story_decomposition'],
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
      project: ADO_PROJECT || 'TradeEasy',
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
      url: `${ADO_BASE}/_build/results?buildId=4821`,
      status: 'inProgress',
    },
  });

  await sleep(1400);

  const adoFixture = FIXTURE_THEME === 'messaging'
    ? { epic: 'In-App Messaging & Trade Chat', features: ['Channel Discovery & Membership', 'Real-Time Messaging', 'Content Moderation & Compliance'], storiesTotal: 8 }
    : { epic: 'Price Alerts & Watchlist', features: ['Alert Configuration', 'Push Notification Delivery', 'Alert History & Management'], storiesTotal: 12 };

  send(ws, {
    type: 'ado_creating_items',
    label: `Creating ADO work items — Epic → Features → ${ADO_STORY_TYPE}s`,
    timestamp: now(),
    payload: adoFixture,
  });

  // Kick off real ADO ticket creation in the background while code generation streams.
  // Falls back to mock counts if credentials are not configured or creation fails.
  const adoPromise: Promise<{ epicId: number; featureCount: number; storyCount: number } | null> =
    ADO_ORG && ADO_PROJECT && ADO_PAT ? createDemoAdoItems() : Promise.resolve(null);

  await sleep(400);
  send(ws, {
    type: 'code_generation_start',
    label: 'Claude Code — generating PriceAlertService.ts',
    timestamp: now(),
    payload: FIXTURE_THEME === 'messaging'
      ? { file: 'src/services/MessageService.ts', ticket: 'F2.S1' }
      : { file: 'src/services/PriceAlertService.ts', ticket: 'F1.S1' },
  });

  // Stream code lines (ADO creation runs concurrently)
  for (const line of CODE_LINES) {
    if (ws.readyState !== WebSocket.OPEN) break;
    send(ws, {
      type: 'code_line',
      label: line,
      timestamp: now(),
    });
    await sleep(line.length > 0 ? 80 + Math.random() * 60 : 40);
  }

  // Wait for real ADO result (usually already done by now)
  const adoResult = await adoPromise;

  await sleep(500);
  send(ws, {
    type: 'ado_sync_complete',
    label: adoResult
      ? `ADO sync complete — ${adoResult.featureCount} features, ${adoResult.storyCount} ${ADO_STORY_TYPE.toLowerCase()}s created`
      : 'ADO sync complete',
    timestamp: now(),
    payload: adoResult ? {
      created: 1 + adoResult.featureCount + adoResult.storyCount,
      updated: 0,
      epics: 1,
      features: adoResult.featureCount,
      [`${ADO_STORY_TYPE.toLowerCase()}s`]: adoResult.storyCount,
      epicId: adoResult.epicId,
      url: `${ADO_BASE}/_backlogs/backlog`,
    } : {
      created: 16,
      updated: 0,
      epics: 1,
      features: 3,
      [`${ADO_STORY_TYPE.toLowerCase()}s`]: 12,
      url: `${ADO_BASE}/_backlogs/backlog`,
    },
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
