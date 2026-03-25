"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  AiSettings,
  AiSettingsDraft,
  getDefaultDraftForProvider,
  getProviderBaseUrl,
  isAiSettingsConfigured,
} from "@/lib/ai-settings";
import { loadAiSettingsDraft, saveAiSettingsDraft } from "@/lib/ai-settings-client";

type AiSettingsContextValue = {
  draft: AiSettingsDraft;
  configuredSettings: AiSettings | null;
  isConfigured: boolean;
  isLoaded: boolean;
  updateDraft: (nextDraft: AiSettingsDraft) => void;
  resetDraft: () => void;
};

const AiSettingsContext = createContext<AiSettingsContextValue | null>(null);

const DEFAULT_DRAFT = getDefaultDraftForProvider("openrouter");

export const AiSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [draft, setDraft] = useState<AiSettingsDraft>(DEFAULT_DRAFT);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const syncFromStorage = () => {
      const storedDraft = loadAiSettingsDraft();
      setDraft(storedDraft ?? DEFAULT_DRAFT);
      setIsLoaded(true);
    };

    syncFromStorage();
    window.addEventListener("knox:ai-settings-updated", syncFromStorage);

    return () => {
      window.removeEventListener("knox:ai-settings-updated", syncFromStorage);
    };
  }, []);

  const configuredSettings = useMemo(() => {
    if (!isAiSettingsConfigured(draft)) {
      return null;
    }

    return {
      ...draft,
      baseURL: getProviderBaseUrl(draft.provider, draft.baseURL),
    };
  }, [draft]);

  const value = useMemo<AiSettingsContextValue>(
    () => ({
      draft,
      configuredSettings,
      isConfigured: configuredSettings !== null,
      isLoaded,
      updateDraft: (nextDraft) => {
        setDraft(nextDraft);
        saveAiSettingsDraft(nextDraft);
      },
      resetDraft: () => {
        setDraft(DEFAULT_DRAFT);
        saveAiSettingsDraft(DEFAULT_DRAFT);
      },
    }),
    [configuredSettings, draft, isLoaded],
  );

  return (
    <AiSettingsContext.Provider value={value}>
      {children}
    </AiSettingsContext.Provider>
  );
};

export const useAiSettings = () => {
  const context = useContext(AiSettingsContext);
  if (!context) {
    throw new Error("useAiSettings must be used within an AiSettingsProvider");
  }

  return context;
};
