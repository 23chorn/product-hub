import type { CoordinatorMessage } from '../../../stores/workflowStore';
import { getEventCfg, formatTs } from './event-config';
import { ExpandableRow } from './ExpandableRow';

/** Render a single pipeline event as a terminal row, with type-specific styling and links. */
export function EventRow({ msg }: { msg: CoordinatorMessage }) {
  if (msg.eventType === 'curator_reasoning') {
    return (
      <ExpandableRow
        label="context updates"
        labelColor="text-brand-600 dark:text-brand-500"
        borderColor="border-brand-200 dark:border-brand-800/40"
        bgColor="bg-brand-50 dark:bg-brand-900/10"
        content={msg.content}
        timestamp={msg.timestamp}
      />
    );
  }

  if (msg.eventType === 'validation_warning') {
    return (
      <ExpandableRow
        label="validation"
        labelColor="text-amber-600 dark:text-amber-500"
        borderColor="border-amber-200 dark:border-amber-800/40"
        bgColor="bg-amber-50 dark:bg-amber-900/10"
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
        labelColor="text-lime-600 dark:text-lime-500"
        borderColor="border-lime-200 dark:border-lime-800/40"
        bgColor="bg-lime-50 dark:bg-lime-900/10"
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
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors hover:bg-surface-100 dark:hover:bg-surface-800/20 ${isProgress ? 'opacity-60' : ''}`}>
      {/* Icon badge */}
      <div className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] ${cfg.bgColor}`}>
        <span className={cfg.color}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-surface-700 dark:text-surface-300 leading-tight font-mono truncate">{title}</span>
          <span className="flex-shrink-0 text-[11px] text-surface-400 dark:text-surface-700 font-mono">{formatTs(msg.timestamp)}</span>
        </div>
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
    </div>
  );
}
