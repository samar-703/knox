"use client";

import {
  AI_SETTINGS_STORAGE_KEY,
  AiSettings,
  AiSettingsDraft,
  aiSettingsDraftSchema,
  aiSettingsSchema,
  getProviderBaseUrl,
  isAiSettingsConfigured,
} from "@/lib/ai-settings";

export const loadAiSettingsDraft = (): AiSettingsDraft | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    const result = aiSettingsDraftSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

export const loadAiSettings = (): AiSettings | null => {
  const draft = loadAiSettingsDraft();
  if (!draft || !isAiSettingsConfigured(draft)) {
    return null;
  }

  return aiSettingsSchema.parse({
    ...draft,
    baseURL: getProviderBaseUrl(draft.provider, draft.baseURL),
  });
};

export const saveAiSettingsDraft = (draft: AiSettingsDraft) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(draft));
  window.dispatchEvent(new CustomEvent("knox:ai-settings-updated"));
};

export const clearAiSettingsDraft = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("knox:ai-settings-updated"));
};
