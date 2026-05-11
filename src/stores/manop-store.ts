import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ManoPStoreConfig {
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
}

interface ManoPStore {
  config: ManoPStoreConfig;
  setConfig: (config: Partial<ManoPStoreConfig>) => void;
  resetConfig: () => void;
}

const DEFAULT_CONFIG: ManoPStoreConfig = {
  baseUrl: "http://localhost:7861",
  temperature: 0.7,
  maxTokens: 256,
  topP: 0.8,
  topK: 20,
};

export const useManoPStore = create<ManoPStore>()(
  persist(
    (set) => ({
      config: { ...DEFAULT_CONFIG },
      setConfig: (partial) =>
        set((state) => ({ config: { ...state.config, ...partial } })),
      resetConfig: () => set({ config: { ...DEFAULT_CONFIG } }),
    }),
    {
      name: "manop-store",
      version: 1,
    }
  )
);
