import { useModelStore } from '../stores/modelStore';

export function ModelSelector() {
  const { availableModels, selectedModelId, setSelectedModelId } = useModelStore();

  if (availableModels.length < 2) return null;

  return (
    <div className="flex items-center space-x-1.5">
      <select
        value={selectedModelId ?? availableModels[0]?.id ?? ''}
        onChange={(e) => setSelectedModelId(e.target.value)}
        className="text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-0 rounded-lg px-2.5 py-1.5 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        title="Select AI model"
      >
        {availableModels.map((m) => (
          <option key={m.id} value={m.id} title={m.description}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
