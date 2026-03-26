import { useState } from 'react';
import type { BacklogData, BacklogStory } from '../../utils/backlog-helpers';

/** Extract personas from backlog data for the sidebar panel */
export function extractPersonas(data: BacklogData) {
  const map = new Map<string, { count: number; stories: { feature: string; title: string; goal?: string; benefit?: string }[] }>();
  const addStory = (s: BacklogStory, featureTitle: string) => {
    if (s.persona) {
      const entry = map.get(s.persona) ?? { count: 0, stories: [] };
      entry.count++;
      entry.stories.push({ feature: featureTitle, title: s.title, goal: s.goal, benefit: s.benefit });
      map.set(s.persona, entry);
    }
  };
  if (data.features) {
    for (const f of data.features) {
      for (const s of f.stories) addStory(s, f.title);
    }
  }
  if (data.feature) {
    for (const s of data.feature.stories) addStory(s, data.feature.title);
  }
  if (data.epic?.stories) {
    for (const s of data.epic.stories) addStory(s, data.epic.title);
  }
  if (data.story) {
    addStory(data.story, 'Single story');
  }
  return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
}

export function PersonaPanel({ personas }: { personas: ReturnType<typeof extractPersonas> }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-400 mb-2">
        Personas ({personas.length})
      </p>
      <div className="space-y-1">
        {personas.map(([name, info]) => (
          <div key={name}>
            <button
              onClick={() => setExpanded(expanded === name ? null : name)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <svg
                  className={`w-3 h-3 flex-shrink-0 text-purple-400 transition-transform ${expanded === name ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-xs text-gray-700 dark:text-gray-300 text-left">{name}</span>
              </div>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex-shrink-0">
                {info.count}
              </span>
            </button>
            {expanded === name && (
              <div className="ml-5 mt-1 mb-2 space-y-1.5">
                {info.stories.map((s, i) => (
                  <div key={i} className="text-xs border-l-2 border-purple-200 dark:border-purple-700 pl-2">
                    <p className="font-medium text-gray-700 dark:text-gray-300">{s.title}</p>
                    <p className="text-gray-400 dark:text-gray-500">{s.feature}</p>
                    {s.goal && <p className="text-gray-500 dark:text-gray-400 italic mt-0.5">I want {s.goal}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
