import { STAGE_LABELS } from '../constants/stage-labels';

interface WorkflowEvent {
  id: number;
  workflow_id: string;
  event_type: string;
  stage: string | null;
  summary: string;
  details: string | null;
  created_at: number;
}

/**
 * Convert a workflow event to a coordinator message for the chat narration.
 * Returns null if the event shouldn't be displayed.
 */
export function eventToMessage(event: WorkflowEvent): { role: 'coordinator'; content: string; timestamp: number; eventType: string; stage?: string } | null {
  let content = event.summary;

  // stage_completed / ado_pushed — append external URLs for direct linking.
  // A feature refinement push can carry up to three distinct links (epic, feature,
  // test plan) — emit one "→ Label: url" line per link present so all of them render,
  // not just whichever happened to be checked first.
  if ((event.event_type === 'stage_completed' || event.event_type === 'ado_pushed') && event.details) {
    try {
      const details = JSON.parse(event.details);
      if (details.wiki_url) {
        content = `${content}\n→ ${details.wiki_url}`;
      } else if (details.epic_url || details.feature_url || details.test_plan_url) {
        const lines: string[] = [];
        if (details.epic_url) lines.push(`→ View Epic: ${details.epic_url}`);
        if (details.feature_url) lines.push(`→ View Feature: ${details.feature_url}`);
        if (details.test_plan_url) lines.push(`→ View Test Plan: ${details.test_plan_url}`);
        content = `${content}\n${lines.join('\n')}`;
      } else if (details.ado_url) {
        content = `${content}\n→ ${details.ado_url}`;
      }
    } catch { /* ignore */ }
  }

  // Format critic verdict with structured issues
  if (event.event_type === 'critic_verdict' && event.details) {
    try {
      const details = JSON.parse(event.details);
      const verdict = details.critic_verdict;
      const stage = STAGE_LABELS[details.reviewed_stage ?? event.stage] ?? event.stage;
      const parts: string[] = [];

      if (verdict === 'approve') {
        const minorCount = details.issue_count - (details.critical_issues ?? 0) - (details.major_issues ?? 0);
        parts.push(`**Quality Review — ${stage}** ✓`);
        if (minorCount > 0) {
          parts.push(`Passed with ${minorCount} minor note${minorCount !== 1 ? 's' : ''} (resolved internally).`);
        } else {
          parts.push('No issues found.');
        }
      } else {
        parts.push(`**Quality Review — ${stage}**`);
        if (details.issue_count) {
          const counts: string[] = [];
          if (details.critical_issues) counts.push(`${details.critical_issues} critical`);
          if (details.major_issues) counts.push(`${details.major_issues} major`);
          const minorCount = details.issue_count - (details.critical_issues ?? 0) - (details.major_issues ?? 0);
          if (minorCount > 0) counts.push(`${minorCount} minor`);
          parts.push(`**${details.issue_count} issue${details.issue_count !== 1 ? 's' : ''}** flagged (${counts.join(', ')})`);
        }

        // Format individual issues as a bulleted list
        if (details.issues_summary) {
          const issues = details.issues_summary.split('; ').filter((s: string) => s.trim());
          if (issues.length > 0) {
            parts.push('');
            for (const issue of issues) {
              const match = issue.match(/^\[(\w+)\]\s*[—-]?\s*(.*)/s);
              if (match) {
                const sev = match[1].toLowerCase();
                const icon = sev === 'critical' ? '🔴' : sev === 'major' ? '🟠' : '🟡';
                parts.push(`${icon} **${match[1]}**: ${match[2]}`);
              } else {
                parts.push(`- ${issue}`);
              }
            }
          }
        }
      }

      content = parts.join('\n');
    } catch { /* fall through to raw summary */ }
  }

  // Wiki sync after approval — append the wiki URL
  if (event.event_type === 'wiki_synced' && event.details) {
    try {
      const details = JSON.parse(event.details);
      if (details.wiki_url) content = `${content}\n→ ${details.wiki_url}`;
    } catch { /* ignore */ }
  }

  // Board sync — surface the top-level ticket or test plan URL prominently
  if (event.event_type === 'board_synced' && event.details) {
    try {
      const details = JSON.parse(event.details);
      if (details.plan_id) {
        // Test plan push
        const url = details.plan_url;
        const parts = [`Test Plan #${details.plan_id} ${details.created > 0 ? 'created' : 'synced'} on Azure DevOps`];
        if (details.created > 0) parts.push(`${details.created} test case${details.created !== 1 ? 's' : ''} added`);
        if (url) parts.push(`→ ${url}`);
        content = parts.join('\n');
      } else {
        // Board (Epic/Feature/Story) push
        const url = details.top_url;
        const id = details.top_id;
        const level: string = details.level ?? 'Epic';
        const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
        const parts = [`${levelLabel} #${id} created on Azure DevOps`];
        if (details.feature_count) parts.push(`${details.feature_count} feature${details.feature_count !== 1 ? 's' : ''}`);
        if (details.story_count) parts.push(`${details.story_count} stor${details.story_count !== 1 ? 'ies' : 'y'}`);
        if (url) parts.push(`→ ${url}`);
        content = parts.join('\n');
      }
    } catch { /* use summary */ }
  }

  // Show curator reasoning log
  if (event.event_type === 'curator_reasoning' && event.details) {
    try {
      const details = JSON.parse(event.details);
      if (details.full_reasoning) {
        content = `**Curator reasoning:**\n\n${details.full_reasoning}`;
      }
    } catch { /* ignore */ }
  }

  return {
    role: 'coordinator',
    content,
    timestamp: event.created_at,
    eventType: event.event_type,
    stage: event.stage ?? undefined,
  };
}
