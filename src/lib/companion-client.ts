"use client";

import {
  CompanionGitStatusResponse,
  CompanionHealthResponse,
  CompanionJobResponse,
  CompanionSettings,
  COMPANION_SETTINGS_STORAGE_KEY,
  getDefaultCompanionSettings,
} from "@/lib/companion";

type SyncEntry = {
  path: string;
  type: "file" | "folder";
  content?: string;
};

const buildHeaders = (token: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
};

export const loadCompanionSettings = (): CompanionSettings => {
  if (typeof window === "undefined") {
    return getDefaultCompanionSettings();
  }

  const rawValue = window.localStorage.getItem(COMPANION_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return getDefaultCompanionSettings();
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CompanionSettings>;
    return {
      baseUrl: parsed.baseUrl?.trim() || "http://127.0.0.1:4318",
      token: parsed.token ?? "",
      projectRepoPaths: parsed.projectRepoPaths ?? {},
      projectJobIds: parsed.projectJobIds ?? {},
    };
  } catch {
    return getDefaultCompanionSettings();
  }
};

export const saveCompanionSettings = (settings: CompanionSettings) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    COMPANION_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  );
  window.dispatchEvent(new CustomEvent("knox:companion-settings-updated"));
};

const companionFetch = async <T>(
  settings: CompanionSettings,
  path: string,
  init?: RequestInit,
) => {
  const response = await fetch(`${settings.baseUrl}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(settings.token),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `Companion request failed (${response.status})`);
  }

  return (await response.json()) as T;
};

export const getCompanionHealth = (settings: CompanionSettings) =>
  companionFetch<CompanionHealthResponse>(settings, "/health");

export const syncProjectToCompanion = (
  settings: CompanionSettings,
  projectId: string,
  repoPath: string,
  entries: SyncEntry[],
) =>
  companionFetch<{ ok: true; syncedEntries: number }>(settings, "/workspace/sync", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      repoPath,
      entries,
    }),
  });

export const getCompanionGitStatus = (
  settings: CompanionSettings,
  repoPath: string,
) =>
  companionFetch<CompanionGitStatusResponse>(settings, "/git/status", {
    method: "POST",
    body: JSON.stringify({ repoPath }),
  });

export const commitWithCompanion = (
  settings: CompanionSettings,
  repoPath: string,
  message: string,
) =>
  companionFetch<{ ok: true; summary: string }>(settings, "/git/commit", {
    method: "POST",
    body: JSON.stringify({ repoPath, message }),
  });

export const pushWithCompanion = (
  settings: CompanionSettings,
  repoPath: string,
) =>
  companionFetch<{ ok: true; summary: string }>(settings, "/git/push", {
    method: "POST",
    body: JSON.stringify({ repoPath }),
  });

export const createCompanionCommandJob = (
  settings: CompanionSettings,
  repoPath: string,
  command: string,
) =>
  companionFetch<CompanionJobResponse>(settings, "/jobs/command", {
    method: "POST",
    body: JSON.stringify({ repoPath, command }),
  });

export const getCompanionJob = (
  settings: CompanionSettings,
  jobId: string,
) => companionFetch<CompanionJobResponse>(settings, `/jobs/${jobId}`);
