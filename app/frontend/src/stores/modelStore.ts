import { create } from 'zustand';
import type { ModelOption } from '@pap/shared';

interface ModelState {
  selectedModelId: string | null;
  availableModels: ModelOption[];
  agentModels: Record<string, string>;
  setSelectedModelId: (id: string) => void;
  setAvailableModels: (models: ModelOption[]) => void;
  setAgentModels: (agentModels: Record<string, string>) => void;
}

export const useModelStore = create<ModelState>(() => {
  // Initialize selected model from localStorage
  const saved = localStorage.getItem('selectedModel');

  return {
    selectedModelId: saved || null,
    availableModels: [],
    agentModels: {},

    setSelectedModelId: (id: string) => {
      localStorage.setItem('selectedModel', id);
      useModelStore.setState({ selectedModelId: id });
    },

    setAvailableModels: (models: ModelOption[]) => {
      const current = localStorage.getItem('selectedModel');
      // Clear saved preference if the model is no longer available
      const isStillValid = current && models.some(m => m.id === current);
      if (!isStillValid && current) {
        localStorage.removeItem('selectedModel');
      }
      useModelStore.setState({
        availableModels: models,
        selectedModelId: isStillValid ? current : null,
      });
    },

    setAgentModels: (agentModels: Record<string, string>) => {
      useModelStore.setState({ agentModels });
    },
  };
});
