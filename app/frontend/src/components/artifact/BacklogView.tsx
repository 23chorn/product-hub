import { useState } from 'react';
import type { BacklogData, BacklogStory } from '../../utils/backlog-helpers';
import { backlogTier, getSprintMeta, getAllStories, getAllFeatures } from '../../utils/backlog-helpers';

/** Render hours with AI comparison: "3h (was 8h)" or just "8h" when not AI-assisted. */
function HoursDisplay({ story, aiAssisted }: { story: BacklogStory; aiAssisted: boolean }) {
  if (!story.estimatedHours) return null;
  if (aiAssisted && story.traditionalHours != null && story.traditionalHours !== story.estimatedHours) {
    return <> · {story.estimatedHours}h <span className="line-through opacity-50">{story.traditionalHours}h</span></>;
  }
  return <> · {story.estimatedHours}h</>;
}

/** Render technical notes (iOS / Android / Backend) added by the tech refinement stage. */
function TechnicalNotes({ notes }: { notes?: BacklogStory['technical_notes'] }) {
  if (!notes || (!notes.ios && !notes.android && !notes.backend)) return null;
  const items: Array<{ key: string; label: string; color: string; note: string }> = [];
  if (notes.ios) items.push({ key: 'ios', label: 'iOS', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', note: notes.ios });
  if (notes.android) items.push({ key: 'android', label: 'Android', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', note: notes.android });
  if (notes.backend) items.push({ key: 'backend', label: 'Backend', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', note: notes.backend });
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Technical Notes:</p>
      {items.map(({ key, label, color, note }) => (
        <div key={key} className="flex gap-1.5 items-start">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${color}`}>{label}</span>
          <p className="text-xs text-slate-600 dark:text-slate-400">{note}</p>
        </div>
      ))}
    </div>
  );
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
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {hasFeatures && <>{features.length} feature{features.length !== 1 ? 's' : ''} · </>}{totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
              {totalEffort > 0 && <> · {totalEffort} pts</>}
              <AggregateHours hours={totalHours} traditionalHours={totalTraditionalHours} aiAssisted={aiAssisted} />
              {sprintMeta?.sprintsRequired != null && (
                <> · {sprintMeta.sprintsRequired} sprints</>
              )}
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{data.epic.title}</h3>
          {data.epic.description && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{data.epic.description}</p>
          )}
          {data.epic.businessValue && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 italic">{data.epic.businessValue}</p>
          )}
        </div>
      )}

      {/* Feature header — only for Tier 2 (single feature without epic) */}
      {tier === 2 && data.feature && (
        <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-teal-500 dark:text-teal-400">Feature</span>
            {data.feature.phase && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                data.feature.phase === 'MVP'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
                {data.feature.phase}
              </span>
            )}
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {totalStories} stor{totalStories !== 1 ? 'ies' : 'y'}
              {totalEffort > 0 && <> · {totalEffort} pts</>}
              <AggregateHours hours={totalHours} traditionalHours={totalTraditionalHours} aiAssisted={aiAssisted} />
              {sprintMeta?.sprintsRequired != null && (
                <> · {sprintMeta.sprintsRequired} sprints</>
              )}
            </span>
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{data.feature.title}</h3>
          {data.feature.description && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{data.feature.description}</p>
          )}
        </div>
      )}

      {/* Story detail — only for Tier 1 (single story, always expanded) */}
      {tier === 1 && data.story && (() => {
        const story = data.story;
        return (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500 dark:text-emerald-400">Story</span>
              {story.effort != null && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    : 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400'
                }`}>
                  {story.effort} pts<HoursDisplay story={story} aiAssisted={aiAssisted} />
                </span>
              )}
              {sprintMeta?.sprintsRequired != null && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  · {sprintMeta.sprintsRequired} sprints
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{story.title}</h3>
            {/* Support both old format (persona/goal/benefit) and new format (as_a/i_want/so_that) */}
            {(story.persona || story.as_a) && (
              <div><span className="text-xs font-medium text-slate-500 dark:text-slate-400">As a: </span><span className="text-xs text-slate-700 dark:text-slate-300">{story.as_a || story.persona}</span></div>
            )}
            {(story.goal || story.i_want) && (
              <div><span className="text-xs font-medium text-slate-500 dark:text-slate-400">I want: </span><span className="text-xs text-slate-700 dark:text-slate-300">{story.i_want || story.goal}</span></div>
            )}
            {(story.benefit || story.so_that) && (
              <div><span className="text-xs font-medium text-slate-500 dark:text-slate-400">So that: </span><span className="text-xs text-slate-700 dark:text-slate-300">{story.so_that || story.benefit}</span></div>
            )}
            {((story.acceptanceCriteria || story.acceptance_criteria) && (story.acceptanceCriteria || story.acceptance_criteria).length > 0) && (
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {(story.acceptanceCriteria || story.acceptance_criteria).map((ac, ai) => (
                    <li key={ai} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
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

            {/* Technical Acceptance Criteria (new multi-agent format) */}
            {story.technical_acceptance_criteria && story.technical_acceptance_criteria.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Technical Acceptance Criteria:</p>
                <ul className="space-y-1">
                  {story.technical_acceptance_criteria.map((tac, ti) => (
                    <li key={ti} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
                      <span className="text-blue-500 mt-px flex-shrink-0">⚙</span>
                      <span>{tac}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Platform tags (new multi-agent format) */}
            {story.platform && story.platform.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {story.platform.map(p => (
                  <span key={p} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    p === 'backend' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                    : p === 'web' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : p === 'ios' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400'
                    : p === 'android' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
                  }`}>
                    {p.toUpperCase()}
                  </span>
                ))}
              </div>
            )}

            {/* Test Cases (new multi-agent format) */}
            {story.test_cases && story.test_cases.length > 0 && (
              <div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Test Cases ({story.test_cases.length}):</p>
                <div className="space-y-2">
                  {story.test_cases.map(tc => (
                    <div key={tc.id} className="bg-slate-50 dark:bg-slate-800/50 rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{tc.id}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tc.type === 'happy_path' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : tc.type === 'bad_path' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          {tc.type.replace('_', ' ')}
                        </span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          tc.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : tc.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                          : tc.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
                        }`}>
                          {tc.priority}
                        </span>
                      </div>
                      <div className="space-y-0.5 text-xs">
                        {tc.scenario.given.map((g, gi) => (
                          <div key={`g${gi}`} className="text-slate-600 dark:text-slate-400">
                            <strong className="text-slate-700 dark:text-slate-300">Given</strong> {g}
                          </div>
                        ))}
                        {tc.scenario.when.map((w, wi) => (
                          <div key={`w${wi}`} className="text-slate-600 dark:text-slate-400">
                            <strong className="text-slate-700 dark:text-slate-300">When</strong> {w}
                          </div>
                        ))}
                        {tc.scenario.then.map((t, ti) => (
                          <div key={`t${ti}`} className="text-slate-600 dark:text-slate-400">
                            <strong className="text-slate-700 dark:text-slate-300">Then</strong> {t}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {story.agentContext && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2 mt-1">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">Agent Context:</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">{story.agentContext}</p>
              </div>
            )}
            <TechnicalNotes notes={story.technical_notes} />
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
                  className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-900 dark:text-slate-100 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      {story.title}
                    </span>
                    {story.effort != null && (
                      <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        story.effort >= 8 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : story.effort >= 5 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400'
                      }`}>
                        {story.effort}<HoursDisplay story={story} aiAssisted={aiAssisted} />
                      </span>
                    )}
                  </div>
                  {(story.persona || story.as_a) && !isExpanded && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">{story.as_a || story.persona}</p>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="ml-5.5 mt-2 space-y-2 pl-4 border-l-2 border-slate-100 dark:border-slate-700">
                  {/* Support both old format (persona/goal/benefit) and new format (as_a/i_want/so_that) */}
                  {(story.persona || story.as_a) && (
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">As a: </span>
                      <span className="text-xs text-slate-700 dark:text-slate-300">{story.as_a || story.persona}</span>
                    </div>
                  )}
                  {(story.goal || story.i_want) && (
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">I want: </span>
                      <span className="text-xs text-slate-700 dark:text-slate-300">{story.i_want || story.goal}</span>
                    </div>
                  )}
                  {(story.benefit || story.so_that) && (
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">So that: </span>
                      <span className="text-xs text-slate-700 dark:text-slate-300">{story.so_that || story.benefit}</span>
                    </div>
                  )}
                  {((story.acceptanceCriteria || story.acceptance_criteria) && (story.acceptanceCriteria || story.acceptance_criteria).length > 0) && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Acceptance Criteria:</p>
                      <ul className="space-y-1">
                        {(story.acceptanceCriteria || story.acceptance_criteria).map((ac, ai) => (
                          <li key={ai} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
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

                  {/* Technical Acceptance Criteria (new multi-agent format) */}
                  {story.technical_acceptance_criteria && story.technical_acceptance_criteria.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Technical Acceptance Criteria:</p>
                      <ul className="space-y-1">
                        {story.technical_acceptance_criteria.map((tac, ti) => (
                          <li key={ti} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
                            <span className="text-blue-500 mt-px flex-shrink-0">⚙</span>
                            <span>{tac}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Platform tags (new multi-agent format) */}
                  {story.platform && story.platform.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {story.platform.map(p => (
                        <span key={p} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          p === 'backend' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                          : p === 'web' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          : p === 'ios' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400'
                          : p === 'android' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
                        }`}>
                          {p.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Test Cases (new multi-agent format) */}
                  {story.test_cases && story.test_cases.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Test Cases ({story.test_cases.length}):</p>
                      <div className="space-y-2">
                        {story.test_cases.map(tc => (
                          <div key={tc.id} className="bg-slate-50 dark:bg-slate-800/50 rounded p-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{tc.id}</span>
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                                tc.type === 'happy_path' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : tc.type === 'bad_path' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                              }`}>
                                {tc.type.replace('_', ' ')}
                              </span>
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                                tc.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                : tc.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                                : tc.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
                              }`}>
                                {tc.priority}
                              </span>
                            </div>
                            <div className="space-y-0.5 text-xs">
                              {tc.scenario.given.map((g, gi) => (
                                <div key={`g${gi}`} className="text-slate-600 dark:text-slate-400">
                                  <strong className="text-slate-700 dark:text-slate-300">Given</strong> {g}
                                </div>
                              ))}
                              {tc.scenario.when.map((w, wi) => (
                                <div key={`w${wi}`} className="text-slate-600 dark:text-slate-400">
                                  <strong className="text-slate-700 dark:text-slate-300">When</strong> {w}
                                </div>
                              ))}
                              {tc.scenario.then.map((t, ti) => (
                                <div key={`t${ti}`} className="text-slate-600 dark:text-slate-400">
                                  <strong className="text-slate-700 dark:text-slate-300">Then</strong> {t}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {story.agentContext && (
                    <div className="bg-slate-50 dark:bg-slate-800 rounded p-2 mt-1">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5">Agent Context:</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{story.agentContext}</p>
                    </div>
                  )}
                  <TechnicalNotes notes={story.technical_notes} />
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
              <div key={fi} className="rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 rounded-t-lg">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-teal-500 dark:text-teal-400">Feature</span>
                    {feature.phase && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        feature.phase === 'MVP'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}>
                        {feature.phase}
                      </span>
                    )}
                    {featureEffort > 0 && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {featureEffort} pts
                        <AggregateHours hours={featureHours} traditionalHours={featureTraditionalHours} aiAssisted={aiAssisted} />
                        {ev && ev > 0 && (
                          <> · {Math.round((featureEffort / ev) * 10) / 10} sprints</>
                        )}
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{feature.title}</h4>
                  {feature.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{feature.description}</p>
                  )}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {feature.stories.map((story, si) => renderStory(story, si, `${fi + 1}`))}
                </div>
              </div>
            );
          });
        }

        // Tier 2 feature stories — render directly (header already shown above)
        if (tier === 2 && data.feature) {
          return (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.feature.stories.map((story, si) => renderStory(story, si, '1'))}
              </div>
            </div>
          );
        }

        // Legacy flat stories on epic — no feature wrapper
        const flatStories = data.epic?.stories ?? [];
        return (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {flatStories.map((story, si) => renderStory(story, si, '1'))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
