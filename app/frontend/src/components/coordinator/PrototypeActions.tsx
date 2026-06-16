interface PrototypeActionsProps {
  prototypeData: any;
  onShowCRForm: () => void;
}

export function PrototypeActions({
  prototypeData,
  onShowCRForm,
}: PrototypeActionsProps) {
  return (
    <div className="flex justify-center gap-2">
      <button
        onClick={onShowCRForm}
        className="text-xs px-3 py-1.5 rounded-md border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
      >
        Change Request
      </button>
    </div>
  );
}
