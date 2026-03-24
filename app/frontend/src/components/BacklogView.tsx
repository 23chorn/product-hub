import { useState } from 'react';
import type { BacklogData, BacklogStory } from '../utils/backlog-helpers';
import { backlogTier, getSprintMeta, getAllStories, getAllFeatures } from '../utils/backlog-helpers';

/** Render hours with AI comparison: "3h (was 8h)" or just "8h" when not AI-assisted. */
function HoursDisplay({ story, aiAssisted }: { story: BacklogStory; aiAssisted: boolean }) {
  if (!story.estimatedHours) return null;
  if (aiAssisted && story.traditionalHours != null && story.traditionalHours !== story.estimatedHours) {
    return <> · {story.estimatedHours}h <span className="line-through opacity-50">{story.traditionalHours}h</span></>;
  }
  return <> · {story.estimatedHours}h</>;
}

/** Render aggregate hours with optional AI savings line. */
function AggregateHours({ hours, traditionalHours, aiAssisted }: { hours: number; traditionalHours?: number; aiAssisted: boolean }) {
  if (hours <= 0) return null;
  if (aiAssisted && traditionalHours != null && traditionalHours > 0 && traditionalHours !== hours) {
    const saved = traditionalHours - hours;
    const pct = Math.round((saved / traditionalHours) * 100);
    return <> · {hours}h <span className="line-through opacity-50">{traditionalHours}h</span> <span className="text-emerald-600 dark:text-emerald-400">(-{pct}%)</span></>;
  }
  return <> · {hours}h</>;
}

export function BacklogView({ data }: { data: BacklogData }) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());

  const toggleStory = (key: string) => {
    setExpandedStories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const tier = backlogTier(data);
  const sprintMeta = getSprintMeta(data);
  const allStories = getAllStories(data);
  const features = getAllFeatures(data);
  const hasFeatures = tier === 3 && features.length > 0;
  const aiAssisted = sprintMeta?.aiAssisted ?? false;

  const totalStories = allStories.length;
  const totalEffort = allStories.reduce((s, st) => s + (st.effort ?? 0), 0);
  const totalHours = allStories.reduce((s, st) => s + (st.estimatedHours ?? 0), 0);
  const totalTraditionalHours = sprintMeta?.totalTraditionalHours ?? totalHours;

  return (
    <div className="space-y-4">
      {/* AI-assisted badge */}
      {aiAssisted && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">AI-Assisted Estimates</span>
          <span className="text-xs text-emerald-600 dark:text-emerald-500">Hours reflect AI-augmented development velocity</span>
        </div>
      )}

      {/* Epic header — only for Tier 3 */}
      {tier === 3 && data.epic && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Epic</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {hasFeatures && <>{features.length} feature{features.length !== 1 ? 's' : ''} · </>}{totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
              {totalEffort > 0 && <> · {totalEffort} pts</>}
              <AggregateHours hours={totalHours} traditionalHours={totalTraditionalHours} aiAssisted={aiAssisted} />
              {sprintMeta?.sprintsRequired != null && (
                <> · {sprintMeta.sprintsRequired} sprints</>
              )}
            </span>
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{data.epic.title}</h3>
          {data.epic.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{data.epic.description}</p>
          )}
          {data.epic.businessValue && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">{data.epic.businessValue}</p>
          )}
        </div>
      )}

      {/* Feature header — only for Tier 2 (single feature without epic) */}
      {tier === 2 && data.feature && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-400">Feature</span>
            {data.feature.phase && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                data.feature.phase === 'MVP'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}>
                {data.feature.phase}
              </span>
            )}
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
              {totalEffort > 0 && <> · {totalEffort} pts</>}
              <AggregateHours hours={totalHours} traditionalHours={totalTraditionalHours} aiAssisted={aiAssisted} />
              {sprintMeta?.sprintsRequired != null && (
                <> · {sprintMeta.sprintsRequired} sprints</>
              )}
            </span>
          </div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{data.feature.title}</h3>
          {data.feature.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{data.feature.description}</p>
          )}
        </div>
      )}

      {/* Story detail — only for Tier 1 (single story, always expanded) */}
      {tier === 1 && data.story && (() => {
        const story = data.story;
        return (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500 dark:text-emerald-400">Story</span>
              {story.effort != null && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                }`}>
                  {story.effort} pts<HoursDisplay story={story} aiAssisted={aiAssisted} />
                </span>
              )}
              {sprintMeta?.sprintsRequired != null && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  · {sprintMeta.sprintsRequired} sprints
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{story.title}</h3>
            {story.persona && (
              <div><span className="text-xs font-medium text-gray-500 dark:text-gray-400">Persona: </span><span className="text-xs text-gray-700 dark:text-gray-300">{story.persona}</span></div>
            )}
            {story.goal && (
              <div><span className="text-xs font-medium text-gray-500 dark:text-gray-400">Goal: </span><span className="text-xs text-gray-700 dark:text-gray-300">{story.goal}</span></div>
            )}
            {story.benefit && (
              <div><span className="text-xs font-medium text-gray-500 dark:text-gray-400">Benefit: </span><span className="text-xs text-gray-700 dark:text-gray-300">{story.benefit}</span></div>
            )}
            {story.acceptanceCriteria && story.acceptanceCriteria.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {story.acceptanceCriteria.map((ac, ai) => (
                    <li key={ai} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                      <span className="text-green-500 mt-px flex-shrink-0">✓</span>
                      <span>{ac.split(/\b(Given|When|Then|And|But)\b/gi).map((part, pi) =>
                        /^(Given|When|Then|And|But)$/i.test(part)
                          ? <span key={pi}>{pi > 1 && <br />}<strong>{part}</strong></span>
                          : <span key={pi}>{part}</span>
                      )}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {story.agentContext && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 mt-1">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Agent Context:</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">{story.agentContext}</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Stories renderer — for Tier 2 and 3 */}
      {tier !== 1 && (() => {
        const renderStory = (story: BacklogStory, si: number, prefix: string) => {
          const key = `${prefix}-${si}`;
          const isExpanded = expandedStories.has(key);
          return (
            <div key={si} className="px-4 py-2.5">
              <button
                onClick={() => toggleStory(key)}
                className="w-full text-left flex items-start gap-2 group"
              >
                <svg
                  className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {story.title}
                    </span>
                    {story.effort != null && (
                      <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {story.effort}<HoursDisplay story={story} aiAssisted={aiAssisted} />
                      </span>
                    )}
                  </div>
                  {story.persona && !isExpanded && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{story.persona}</p>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="ml-5.5 mt-2 space-y-2 pl-4 border-l-2 border-gray-100 dark:border-gray-700">
                  {story.persona && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Persona: </span>
                      <span className="text-xs text-gray-700 dark:text-gray-300">{story.persona}</span>
                    </div>
                  )}
                  {story.goal && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Goal: </span>
                      <span className="text-xs text-gray-700 dark:text-gray-300">{story.goal}</span>
                    </div>
                  )}
                  {story.benefit && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Benefit: </span>
                      <span className="text-xs text-gray-700 dark:text-gray-300">{story.benefit}</span>
                    </div>
                  )}
                  {story.acceptanceCriteria && story.acceptanceCriteria.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Acceptance Criteria:</p>
                      <ul className="space-y-1">
                        {story.acceptanceCriteria.map((ac, ai) => (
                          <li key={ai} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                            <span className="text-green-500 mt-px flex-shrink-0">✓</span>
                            <span>{ac.split(/\b(Given|When|Then|And|But)\b/gi).map((part, pi) =>
                              /^(Given|When|Then|And|But)$/i.test(part)
                                ? <span key={pi}>{pi > 1 && <br />}<strong>{part}</strong></span>
                                : <span key={pi}>{part}</span>
                            )}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {story.agentContext && (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 mt-1">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Agent Context:</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">{story.agentContext}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        };

        if (hasFeatures) {
          const ev = sprintMeta?.effectiveVelocity;
          return features.map((feature, fi) => {
            const featureEffort = feature.stories.reduce((s, st) => s + (st.effort ?? 0), 0);
            const featureHours = feature.stories.reduce((s, st) => s + (st.estimatedHours ?? 0), 0);
            const featureTraditionalHours = feature.stories.reduce((s, st) => s + (st.traditionalHours ?? st.estimatedHours ?? 0), 0);
            return (
              <div key={fi} className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-400">Feature</span>
                    {feature.phase && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        feature.phase === 'MVP'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {feature.phase}
                      </span>
                    )}
                    {featureEffort > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {featureEffort} pts
                        <AggregateHours hours={featureHours} traditionalHours={featureTraditionalHours} aiAssisted={aiAssisted} />
                        {ev && ev > 0 && (
                          <> · {Math.round((featureEffort / ev) * 10) / 10} sprints</>
                        )}
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{feature.title}</h4>
                  {feature.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{feature.description}</p>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {feature.stories.map((story, si) => renderStory(story, si, `${fi + 1}`))}
                </div>
              </div>
            );
          });
        }

        // Tier 2 feature stories — render directly (header already shown above)
        if (tier === 2 && data.feature) {
          return (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.feature.stories.map((story, si) => renderStory(story, si, '1'))}
              </div>
            </div>
          );
        }

        // Legacy flat stories on epic — no feature wrapper
        const flatStories = data.epic?.stories ?? [];
        return (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {flatStories.map((story, si) => renderStory(story, si, '1'))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
