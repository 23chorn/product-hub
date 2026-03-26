import ReactMarkdown from 'react-markdown';
import { formatMonthShort } from '../../utils/decision-log-helpers';

interface LogPreviewProps {
  viewingMonth: string | null;
  currentMonthLog: string;
  currentYearMonth: string;
}

export function LogPreview({
  viewingMonth,
  currentMonthLog,
  currentYearMonth,
}: LogPreviewProps) {
  return (
    <aside className="w-80 bg-white dark:bg-gray-800 flex flex-col flex-shrink-0 overflow-hidden">
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
          {viewingMonth ? formatMonthShort(viewingMonth) : 'Log'} — Decisions
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {currentMonthLog ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
            <ReactMarkdown>{currentMonthLog}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-center text-gray-400 dark:text-gray-500">
            <div>
              <p className="text-sm">No decisions logged</p>
              <p className="text-xs mt-1">
                {viewingMonth === currentYearMonth
                  ? 'Chat with Dex and type /log to add entries'
                  : 'No entries for this month'}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
