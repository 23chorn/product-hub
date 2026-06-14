import type { TestCase, SuiteState } from './shared';

/** One platform test-suite row (queued/running/done with pass count). */
export function CheckSuiteRow({
  platform, icon, state, tests, results,
}: {
  platform: string; icon: string; state: SuiteState;
  tests: TestCase[]; results: Map<string, boolean>;
}) {
  const passCount = tests.filter(t => results.get(t.id) ?? true).length;
  const failCount = tests.length - passCount;

  return (
    <div className="flex items-center gap-2.5 py-1">
      {state === 'idle' && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
      )}
      {state === 'running' && (
        <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
          <svg className="w-3 h-3 text-teal-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      )}
      {state === 'done' && failCount === 0 && (
        <span className="w-3.5 h-3.5 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center">
          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {state === 'done' && failCount > 0 && (
        <span className="w-3.5 h-3.5 rounded-full bg-amber-500 flex-shrink-0 flex items-center justify-center">
          <span className="text-[8px] font-bold text-white leading-none">{failCount}</span>
        </span>
      )}
      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 flex-shrink-0">{icon} {platform}</span>
      <span className="text-[10px] font-mono flex-shrink-0">
        {state === 'idle' && <span className="text-slate-400 dark:text-slate-600">queued</span>}
        {state === 'running' && <span className="text-teal-600 dark:text-teal-400 animate-pulse">running…</span>}
        {state === 'done' && (
          <span className={failCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
            {passCount}/{tests.length}
          </span>
        )}
      </span>
    </div>
  );
}
