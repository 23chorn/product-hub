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
export function eventToMessage(event: WorkflowEvent): { role: 'coordinator'; content: string; timestamp: number } | null {
  let content = event.summary;

  // Add excerpt for stage_completed events with artifact
  if (event.event_type === 'stage_completed' && event.details) {
    try {
      const details = JSON.parse(event.details);
      if (details.excerpt) {
        content += `\n\n> ${details.excerpt.slice(0, 150)}${details.excerpt.length > 150 ? '...' : ''}`;
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

  // Show curator reasoning log
  if (event.event_type === 'curator_reasoning' && event.details) {
    try {
      const details = JSON.parse(event.details);
      if (details.full_reasoning) {
        content = `**Curator reasoning:**\n\n${details.full_reasoning}`;
      }
    } catch { /* ignore */ }
  }

  return { role: 'coordinator', content, timestamp: event.created_at };
}
