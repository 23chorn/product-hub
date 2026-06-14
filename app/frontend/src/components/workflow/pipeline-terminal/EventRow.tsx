import type { CoordinatorMessage } from '../../../stores/workflowStore';
import { getEventCfg, formatTs } from './event-config';
import { ExpandableRow } from './ExpandableRow';

/** Render a single pipeline event as a terminal row, with type-specific styling and links. */
export function EventRow({ msg }: { msg: CoordinatorMessage }) {
  if (msg.eventType === 'curator_reasoning') {
    return (
      <ExpandableRow
        label="context updates"
        labelColor="text-teal-600 dark:text-teal-500"
        borderColor="border-teal-200 dark:border-teal-800/40"
        bgColor="bg-teal-50 dark:bg-teal-900/10"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  if (msg.eventType === 'critic_verdict') {
    return (
      <ExpandableRow
        label="quality review"
        labelColor="text-amber-600 dark:text-amber-500"
        borderColor="border-amber-200 dark:border-amber-800/40"
        bgColor="bg-amber-50 dark:bg-amber-900/10"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  const cfg = getEventCfg(msg.eventType ?? '');
  const isProgress = msg.isProgress;

  const lines = msg.content.split('\n').filter(Boolean);
  const title = lines[0] ?? '';
  const detailLines = lines.slice(1).filter(l => !l.startsWith('→ '));
  const detail = detailLines.join(' ').slice(0, 120);

  // Extract URL from line starting with →
  // Handle both formats: "→ url" and "→ Label: url"
  const urlLine = lines.find(l => l.startsWith('→ '))?.replace(/^→\s*/, '') ?? null;
  const externalUrl = urlLine?.includes('https://')
    ? urlLine.substring(urlLine.indexOf('https://'))
    : urlLine;
  const adoStages = new Set(['epic_feature_planner']);
  const isFeatureStage = msg.stage?.startsWith('story_decomposition_F') ?? false;
  const isWikiLink = (msg.eventType === 'stage_completed' || msg.eventType === 'wiki_synced') && !!externalUrl && !adoStages.has(msg.stage ?? '') && !isFeatureStage;
  const isAdoStageLink = (msg.eventType === 'stage_completed' || msg.eventType === 'ado_pushed') && !!externalUrl && (adoStages.has(msg.stage ?? '') || isFeatureStage);
  const isAdoLink = msg.eventType === 'board_synced' && !!externalUrl;

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/20 ${isProgress ? 'opacity-60' : ''}`}>
      {/* Icon badge */}
      <div className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] ${cfg.bgColor}`}>
        <span className={cfg.color}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-slate-700 dark:text-slate-300 leading-tight font-mono truncate">{title}</span>
          <span className="flex-shrink-0 text-[11px] text-slate-400 dark:text-slate-700 font-mono">{formatTs(msg.timestamp)}</span>
        </div>
        {detail && !externalUrl && (
          <p className="text-[12px] text-slate-500 dark:text-slate-600 font-mono mt-0.5 leading-relaxed truncate">{detail}</p>
        )}
        {isWikiLink && (
          <a
            href={externalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-mono underline underline-offset-2 transition-colors"
          >
            open in Azure Wiki ↗
          </a>
        )}
        {isAdoStageLink && (
          <a
            href={externalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-mono underline underline-offset-2 transition-colors"
          >
            {msg.stage === 'epic_feature_planner'
              ? 'Open in Azure Boards ↗'
              : isFeatureStage
              ? 'View Feature in Azure Boards ↗'
              : 'Open in Azure DevOps ↗'}
          </a>
        )}
        {isAdoLink && (
          <a
            href={externalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-mono underline underline-offset-2 transition-colors"
          >
            open in Azure DevOps ↗
          </a>
        )}
      </div>
    </div>
  );
}
