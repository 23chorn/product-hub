import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { TestCase, MediaItem } from './shared';
import { TYPE_COLOR, TYPE_LABEL, PRIORITY_COLOR } from './shared';

/** Modal listing test results with pass/fail filter and media (videos, screenshots). */
export function TestDetailsModal({
  testCases, results, media, isReal, onClose,
}: {
  testCases: TestCase[];
  results: Map<string, boolean>;
  media: MediaItem[];
  isReal: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail'>('all');
  const [activeVideo, setActiveVideo] = useState<string | null>(
    media.find(m => m.type === 'video')?.url ?? null
  );

  const totalPass = testCases.filter(t => results.get(t.id) ?? true).length;
  const totalFail = testCases.length - totalPass;

  const filtered = testCases.filter(tc => {
    const pass = results.get(tc.id) ?? true;
    if (filter === 'pass') return pass;
    if (filter === 'fail') return !pass;
    return true;
  });

  const screenshots = media.filter(m => m.type === 'screenshot');
  const videos = media.filter(m => m.type === 'video');

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-[#0d1117] rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl font-mono">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Test Results</span>
            <span className={`text-[11px] px-2 py-0.5 rounded ${
              totalFail > 0
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            }`}>
              {totalFail > 0 ? `${totalPass}/${testCases.length} passed · ${totalFail} failing` : `${testCases.length}/${testCases.length} passed`}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-600">{isReal ? 'Playwright' : 'Vera'}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pt-3 pb-1 flex-shrink-0">
          <div className="h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${totalFail > 0 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: `${testCases.length > 0 ? Math.round((totalPass / testCases.length) * 100) : 0}%` }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-5 py-2 flex-shrink-0">
          {(['all', 'pass', 'fail'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] px-3 py-1 rounded-full transition-colors ${
                filter === f
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {f === 'all' ? `All (${testCases.length})` : f === 'pass' ? `Passing (${totalPass})` : `Failing (${totalFail})`}
            </button>
          ))}
        </div>

        {/* Test case list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pb-2 space-y-px">
            {filtered.map(tc => {
              const pass = results.get(tc.id) ?? true;
              return (
                <div
                  key={tc.id}
                  className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${
                    pass
                      ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      : 'bg-red-50/60 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20'
                  }`}
                >
                  {/* Pass/fail icon */}
                  {pass ? (
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                      <svg className="w-2 h-2 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                      <svg className="w-2 h-2 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  )}
                  {/* ID */}
                  <span className="flex-shrink-0 w-14 text-[10px] text-slate-400 dark:text-slate-600">{tc.id}</span>
                  {/* Title */}
                  <span className={`flex-1 text-[11px] leading-snug ${
                    pass ? 'text-slate-700 dark:text-slate-300' : 'text-red-700 dark:text-red-300'
                  }`}>
                    {tc.title}
                  </span>
                  {/* Badges */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${TYPE_COLOR[tc.type] ?? 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {TYPE_LABEL[tc.type] ?? tc.type}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 ${PRIORITY_COLOR[tc.priority] ?? 'text-slate-500'}`}>
                      {tc.priority}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Media section */}
          {media.length > 0 && (
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Media
              </span>

              {/* Video player */}
              {videos.length > 0 && (
                <div className="space-y-2">
                  {videos.length > 1 && (
                    <div className="flex gap-1.5">
                      {videos.map((v, i) => (
                        <button
                          key={v.url}
                          onClick={() => setActiveVideo(v.url)}
                          className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                            activeVideo === v.url
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          Video {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeVideo && (
                    <video
                      key={activeVideo}
                      src={activeVideo}
                      controls
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-black"
                      style={{ maxHeight: 280 }}
                    />
                  )}
                </div>
              )}

              {/* Screenshots grid */}
              {screenshots.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Screenshots ({screenshots.length})
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {screenshots.map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-video rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden hover:border-blue-400 dark:hover:border-blue-600 transition-colors bg-slate-900"
                        title={s.name}
                      >
                        <img
                          src={s.url}
                          alt={s.name}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
