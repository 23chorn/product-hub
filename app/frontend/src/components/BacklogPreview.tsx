import { useState, useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useToast } from '../hooks/useToast';
import { api } from '../services/api';
import { useConfigStore } from '../stores/configStore';
import type { BacklogStructure } from '@pap/shared';

export function BacklogPreview() {
  const [collapsedFeatures, setCollapsedFeatures] = useState<Set<number>>(new Set());
  const [collapsedStories, setCollapsedStories] = useState<Set<string>>(new Set());
  const previousBacklogContentRef = useRef<string | null>(null);

  const [pushState, setPushState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [epicUrl, setEpicUrl] = useState<string | null>(null);

  const toast = useToast();
  const { backlogContent, sessionId } = useSessionStore();
  const { config } = useConfigStore();
  const workItems = config?.integrations.workItems ?? 'none';

  // Calculate work item counts from backlog structure
  const getWorkItemCounts = (data: BacklogStructure | null) => {
    if (!data) return { features: 0, stories: 0 };
    const features = data.features.length;
    const stories = data.features.reduce((sum, f) => sum + f.stories.length, 0);
    return { features, stories };
  };

  // Toggle feature collapse
  const toggleFeature = (index: number) => {
    setCollapsedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Toggle story collapse
  const toggleStory = (key: string) => {
    setCollapsedStories(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Copy JSON to clipboard
  const handleCopyJSON = async () => {
    if (!backlogContent) return;

    try {
      await navigator.clipboard.writeText(backlogContent);
      toast.success('Backlog JSON copied to clipboard!');
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  // Push to Azure DevOps
  const handlePushToADO = async () => {
    if (!backlogContent || !sessionId || !backlogData) return;
    setPushState('loading');
    setEpicUrl(null);
    try {
      const result = await api.publishBacklog(sessionId, backlogContent);
      setPushState('success');
      setEpicUrl(result.epicUrl || null);
      toast.success(`Pushed to ADO: Epic #${result.epicId} (${result.featureIds.length} features, ${result.storyIds.length} stories)`);
    } catch (err: any) {
      setPushState('error');
      toast.error(err?.response?.data?.error || err?.message || 'Failed to push to Azure DevOps');
    }
  };

  // Download as JSON file
  const handleDownload = () => {
    if (!backlogContent) return;

    let filename = 'backlog.json';
    try {
      const data = JSON.parse(backlogContent);
      if (data.epic?.title) {
        filename = data.epic.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase() + '.json';
      }
    } catch {
      // Use default filename
    }

    const blob = new Blob([backlogContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  // Reset collapsed state when content changes
  useEffect(() => {
    if (previousBacklogContentRef.current !== backlogContent) {
      setCollapsedFeatures(new Set());
      setCollapsedStories(new Set());
    }
    previousBacklogContentRef.current = backlogContent;
  }, [backlogContent]);

  // Parse backlog JSON — only accept objects with the expected {epic, features} shape
  let backlogData: BacklogStructure | null = null;
  try {
    if (backlogContent) {
      const parsed = JSON.parse(backlogContent);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        parsed.epic &&
        Array.isArray(parsed.features)
      ) {
        backlogData = parsed as BacklogStructure;
      }
    }
  } catch (e) {
    // Invalid JSON, will show error state
  }

  // Parse backlog JSON for counts
  const counts = backlogData ? getWorkItemCounts(backlogData) : null;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header with Action Buttons */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Backlog Preview</h2>
          {backlogContent && (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopyJSON}
                className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center space-x-1.5"
                title="Copy JSON to clipboard"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy JSON</span>
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors flex items-center space-x-1.5"
                title="Download as .json file"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Download</span>
              </button>
              {workItems !== 'none' && (
                pushState === 'success' && epicUrl ? (
                  <a
                    href={epicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40 hover:bg-green-200 dark:hover:bg-green-900/60 rounded-lg font-medium transition-colors flex items-center space-x-1.5"
                    title={`Open Epic in ${workItems === 'jira' ? 'Jira' : 'Azure DevOps'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Pushed — View Epic</span>
                  </a>
                ) : (
                  <button
                    onClick={handlePushToADO}
                    disabled={!backlogData || pushState === 'loading'}
                    className="px-3 py-1.5 text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center space-x-1.5"
                    title={`Push to ${workItems === 'jira' ? 'Jira' : 'Azure DevOps'}`}
                  >
                    {pushState === 'loading' ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        <span>Pushing…</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <span>Push to {workItems === 'jira' ? 'Jira' : 'ADO'}</span>
                      </>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Work Item Count Preview with Total Hours */}
        {counts && (
          <div className="flex items-center space-x-3 text-xs text-gray-600 dark:text-gray-400 mt-3">
            <span className="flex items-center space-x-1">
              <span className="font-medium text-gray-900 dark:text-gray-100">1</span>
              <span>Epic</span>
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="flex items-center space-x-1">
              <span className="font-medium text-gray-900 dark:text-gray-100">{counts.features}</span>
              <span>Feature{counts.features !== 1 ? 's' : ''}</span>
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="flex items-center space-x-1">
              <span className="font-medium text-gray-900 dark:text-gray-100">{counts.stories}</span>
              <span>Stor{counts.stories !== 1 ? 'ies' : 'y'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Backlog Preview or Empty State */}
      {!backlogContent ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-700">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <p className="text-lg font-medium">Backlog structure will appear here</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Type <span className="font-mono bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-xs">e</span> in chat to export the generated backlog
            </p>
          </div>
        </div>
      ) : !backlogData ? (
        <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-700">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <p className="text-lg font-medium">Invalid backlog format</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              The backlog content is not valid JSON
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Epic */}
            <div className="bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-7 h-7 bg-purple-500 text-white rounded flex items-center justify-center font-bold text-xs">
                  E
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-purple-900 dark:text-purple-200">{backlogData.epic.title}</h3>
                  <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">{backlogData.epic.description}</p>
                  {backlogData.epic.businessValue && (
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-1"><strong>Business Value:</strong> {backlogData.epic.businessValue}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Features */}
            {backlogData.features.map((feature, featureIndex) => {
              const isFeatureCollapsed = collapsedFeatures.has(featureIndex);
              const featureStoryCount = feature.stories.length;

              return (
                <div key={featureIndex} className="ml-4 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden">
                  {/* Feature Header - Clickable */}
                  <button
                    onClick={() => toggleFeature(featureIndex)}
                    className="w-full text-left p-3 flex items-start space-x-3 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 text-blue-500 dark:text-blue-400 mt-1 flex-shrink-0 transition-transform ${isFeatureCollapsed ? '' : 'rotate-90'}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    <div className="flex-shrink-0 w-7 h-7 bg-blue-500 text-white rounded flex items-center justify-center font-bold text-xs">
                      F
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-blue-900 dark:text-blue-200 text-sm">{feature.title}</h4>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5 line-clamp-1">{feature.description}</p>
                      <div className="flex items-center space-x-3 mt-1">
                        {feature.phase && (
                          <span className="inline-block text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded">
                            {feature.phase}
                          </span>
                        )}
                        <span className="text-xs text-blue-600 dark:text-blue-400">
                          {featureStoryCount} stor{featureStoryCount !== 1 ? 'ies' : 'y'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Feature Content - Collapsible */}
                  {!isFeatureCollapsed && (
                    <div className="px-3 pb-3 space-y-2">
                      {/* Stories */}
                      {feature.stories.map((story, storyIndex) => {
                        const storyKey = `${featureIndex}-${storyIndex}`;
                        const isStoryCollapsed = collapsedStories.has(storyKey);
                        return (
                          <div key={storyIndex} className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg overflow-hidden">
                            {/* Story Header - Clickable */}
                            <button
                              onClick={() => toggleStory(storyKey)}
                              className="w-full text-left p-2.5 flex items-start space-x-2 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                            >
                              <svg
                                className={`w-3.5 h-3.5 text-green-500 dark:text-green-400 mt-0.5 flex-shrink-0 transition-transform ${isStoryCollapsed ? '' : 'rotate-90'}`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                              </svg>
                              <div className="flex-shrink-0 w-5 h-5 bg-green-500 text-white rounded flex items-center justify-center font-bold" style={{ fontSize: '10px' }}>
                                S
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="font-semibold text-green-900 dark:text-green-200 text-xs">{story.title}</h5>
                              </div>
                            </button>

                            {/* Story Content - Collapsible */}
                            {!isStoryCollapsed && (
                              <div className="px-2.5 pb-2.5">
                                <p className="text-xs text-green-700 dark:text-green-300 italic ml-8 mb-2">
                                  As a {story.persona}, I want {story.goal} so that {story.benefit}
                                </p>

                                {/* Acceptance Criteria */}
                                {story.acceptanceCriteria && story.acceptanceCriteria.length > 0 && (
                                  <div className="ml-8 mb-2">
                                    <p className="text-xs font-medium text-green-800 dark:text-green-200">Acceptance Criteria:</p>
                                    <ul className="text-xs text-green-700 dark:text-green-300 mt-0.5 space-y-0.5 list-disc list-inside">
                                      {story.acceptanceCriteria.map((criteria, criteriaIndex) => (
                                        <li key={criteriaIndex}>{criteria}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
