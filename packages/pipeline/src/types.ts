export interface InitiativeContext {
  overview: string;
  problemStatement?: string;
  targetUsers?: string[];
  successMetrics?: { primary: string; secondary: string[] };
  strategicAlignment?: string;
  constraints?: string[];
  outOfScope?: string[];
  references?: Array<{ title: string; url: string }>;
}

export interface ManifestEpic {
  localKey: string;
  adoId: number;
  adoUrl: string | null;
  title: string;
  description: string | null;
  businessValue: string | null;
  state: string | null;
  stateBucket: string | null;
}

export interface ManifestFeature {
  localKey: string;
  adoId: number;
  adoUrl: string | null;
  title: string;
  description: string | null;
  phase: string | null;
  storyCount: number;
  totalPoints: number;
  state: string | null;
  stateBucket: string | null;
}

export interface ManifestTicket {
  localKey: string;
  adoId: number;
  adoUrl: string | null;
  title: string;
  featureLocalKey: string | null;
  featureTitle: string | null;
  phase: string | null;
  estimatedPoints: number | null;
  platform: string[];
  dependsOn: string[];
  state: string | null;
  stateBucket: string | null;
}

export interface ManifestResponse {
  initiative: {
    seqNum: number;
    id: string;
    title: string;
    context: InitiativeContext | null;
  };
  epic: ManifestEpic | null;
  features: ManifestFeature[];
  tickets: ManifestTicket[];
  implementationOrder: string[];
  stream?: string[];
  phase?: string[];
  blockedTickets?: string[];
}

export interface PayloadTicket {
  localKey: string;
  adoId: number;
  adoUrl: string | null;
  state: string | null;
  stateBucket: string | null;
  featureLocalKey: string | null;
  featureTitle: string | null;
  featureDescription: string | null;
  phase: string | null;
  title: string;
  storyId: string | null;
  persona: string | null;
  goal: string | null;
  benefit: string | null;
  acceptanceCriteria: string[];
  technicalAcceptanceCriteria: string[];
  agentContext: string | null;
  estimatedPoints: number | null;
  estimatedHours: number | null;
  platform: string[];
  dependsOn: string[];
  technicalNotes: Record<string, string> | string | null;
  functionalRequirements: Array<{ id: string; requirement: string }>;
  nonFunctionalRequirements: Array<{ id: string; category: string; requirement: string; priority: string }>;
}

export interface PayloadResponse {
  initiative: { seqNum: number; id: string; title: string };
  tickets: PayloadTicket[];
  notFound?: string[];
}

export interface StateUpdateResponse {
  updated: number[];
  failed: Array<{ adoId: number; error: string }>;
}

export interface RunOptions {
  init: number;
  phase: string;
  stream: string;
  mode: 'interactive' | 'headless';
  api: string;
  key?: string;
  workspace: string;
}
