export const COMPANION_SETTINGS_STORAGE_KEY = "knox.companion.settings.v1";

export interface CompanionSettings {
  baseUrl: string;
  token: string;
  projectRepoPaths: Record<string, string>;
  projectJobIds: Record<string, string>;
}

export interface CompanionHealthResponse {
  ok: true;
  version: string;
  capabilities: string[];
}

export interface CompanionGitStatusResponse {
  branch: string;
  clean: boolean;
  status: string;
}

export interface CompanionJobResponse {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  command: string;
  output: string;
  exitCode: number | null;
  createdAt: number;
  updatedAt: number;
}

export const getDefaultCompanionSettings = (): CompanionSettings => ({
  baseUrl: "http://127.0.0.1:4318",
  token: "",
  projectRepoPaths: {},
  projectJobIds: {},
});
