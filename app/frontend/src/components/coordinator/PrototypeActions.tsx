interface PrototypeActionsProps {
  prototypeData: any;
  protoLoading: boolean;
  onShowCRForm: () => void;
  onViewPrototype: () => void;
  onGeneratePrototype: () => void;
}

export function PrototypeActions({
  prototypeData,
  protoLoading,
  onShowCRForm,
  onViewPrototype,
  onGeneratePrototype,
}: PrototypeActionsProps) {
  return (
    <div className="flex justify-center gap-2">
      <button
        onClick={onShowCRForm}
        className="text-xs px-3 py-1.5 rounded-md border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
      >
        Change Request
      </button>
      {prototypeData ? (
        <button
          onClick={onViewPrototype}
          className="text-xs px-3 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
        >
          View Prototype
        </button>
      ) : (
        <button
          onClick={onGeneratePrototype}
          disabled={protoLoading}
          className="text-xs px-3 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 transition-colors"
        >
          {protoLoading ? 'Generating Prototype...' : 'Generate Prototype'}
        </button>
      )}
    </div>
  );
}
