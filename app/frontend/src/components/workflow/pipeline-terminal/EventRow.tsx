import type { CoordinatorMessage } from '../../../stores/workflowStore';
import { getEventCfg, formatTs, LOG_ROW_GRID } from './event-config';
import { ExpandableRow } from './ExpandableRow';

/** Render a single pipeline event as a terminal row, with type-specific styling and links. */
export function EventRow({ msg }: { msg: CoordinatorMessage }) {
  if (msg.eventType === 'curator_reasoning') {
    return (
      <ExpandableRow
        label="context updates"
        labelColor="text-brand-600 dark:text-brand-500"
        accentColor="border-brand-500"
        bgColor="bg-brand-50/70 dark:bg-brand-900/20"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  if (msg.eventType === 'validation_warning') {
    return (
      <ExpandableRow
        label="validation"
        labelColor="text-amber-700 dark:text-amber-500"
        accentColor="border-amber-500"
        bgColor="bg-amber-50/60 dark:bg-amber-900/20"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  if (msg.eventType === 'critic_verdict') {
    // lime, not amber — amber reads as burnt-orange in the retro theme (its brand
    // accent), which makes this box disappear into the surrounding chrome there.
    return (
      <ExpandableRow
        label="quality review"
        labelColor="text-lime-700 dark:text-lime-500"
        accentColor="border-lime-500"
        bgColor="bg-lime-50/60 dark:bg-lime-900/20"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  const cfg = getEventCfg(msg.eventType ?? '');
  const isProgress = msg.isProgress;

  const lines = msg.content.split('\n').filter(Boolean);
  const title = lines[0] ?? '';
  const urlLines = lines.slice(1).filter(l => l.startsWith('→ '));
  const detailLines = lines.slice(1).filter(l => !l.startsWith('→ '));
  const detail = detailLines.join(' ').slice(0, 120);

  // Extract every "→ url" / "→ Label: url" line. event-to-message.ts emits at most one
  // per checkpoint (feature link for the stories half, test plan link for the _qa half —
  // never both, and never an epic link, which is owned by epic_feature_planner's own event)
  // but this stays generic rather than assuming exactly one.
  const parseUrlLine = (line: string) => {
    const stripped = line.replace(/^→\s*/, '');
    const labelMatch = stripped.match(/^([^:]+):\s*(https:\/\/.+)$/);
    if (labelMatch) return { label: labelMatch[1].trim(), url: labelMatch[2].trim() };
    return { label: null, url: stripped.includes('https://') ? stripped.slice(stripped.indexOf('https://')) : stripped };
  };
  const externalLinks = urlLines.map(parseUrlLine).filter(l => !!l.url);
  const externalUrl = externalLinks[0]?.url ?? null;
  const adoStages = new Set(['epic_feature_planner']);
  const isFeatureStage = msg.stage?.startsWith('story_decomposition_F') ?? false;
  const isWikiLink = (msg.eventType === 'stage_completed' || msg.eventType === 'wiki_synced') && !!externalUrl && !adoStages.has(msg.stage ?? '') && !isFeatureStage;
  const isAdoStageLink = (msg.eventType === 'stage_completed' || msg.eventType === 'ado_pushed') && externalLinks.length > 0 && (adoStages.has(msg.stage ?? '') || isFeatureStage);
  const isAdoLink = msg.eventType === 'board_synced' && !!externalUrl;

  return (
    <div className={`${LOG_ROW_GRID} items-baseline px-2 py-1 rounded transition-colors hover:bg-surface-100 dark:hover:bg-surface-800/50 ${isProgress ? 'opacity-60' : ''}`}>
      <span className={`text-[11px] leading-none ${cfg.color}`}>{cfg.icon}</span>

      {/* Content */}
      <div className="min-w-0">
        <span className="text-sm text-surface-700 dark:text-surface-300 leading-tight font-mono truncate block">{title}</span>
        {detail && !externalUrl && (
          <p className="text-[12px] text-surface-500 dark:text-surface-600 font-mono mt-0.5 leading-relaxed truncate">{detail}</p>
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
          <div className="flex flex-col gap-0.5 mt-0.5">
            {externalLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 font-mono underline underline-offset-2 transition-colors"
              >
                {link.label
                  ? `${link.label} in Azure Boards ↗`
                  // Unlabeled fallback (legacy ado_url-only events) — don't guess which
                  // work item this is from the stage name alone; a story_decomposition_F*
                  // stage can carry a test-plan link just as easily as a feature link.
                  : 'Open in Azure DevOps ↗'}
              </a>
            ))}
          </div>
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

      <span className="text-[11px] text-surface-400 dark:text-surface-700 font-mono tabular-nums text-right">{formatTs(msg.timestamp)}</span>
    </div>
  );
}
