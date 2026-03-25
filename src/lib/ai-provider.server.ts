import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  AiModelPurpose,
  AiSettings,
  aiSettingsSchema,
  getProviderBaseUrl,
  resolveModelForPurpose,
} from "@/lib/ai-settings";

const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const getOpenRouterHeaders = (): Record<string, string> => {
  const siteUrl =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    undefined;

  const headers: Record<string, string> = {
    "X-Title": "Knox",
  };

  if (siteUrl) {
    headers["HTTP-Referer"] = siteUrl;
  }

  return headers;
};

const deriveEncryptionKey = (secret: string) =>
  createHash("sha256").update(secret).digest();

export const parseAiSettings = (value: unknown) => {
  const parsed = aiSettingsSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const normalized = {
    ...parsed.data,
    baseURL: getProviderBaseUrl(parsed.data.provider, parsed.data.baseURL),
  } satisfies AiSettings;

  if (normalized.provider === "custom" && normalized.baseURL.trim().length === 0) {
    return null;
  }

  return normalized;
};

export const getFallbackAiSettings = () => {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return null;
  }

  return {
    provider: "google",
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    baseURL: "",
    chatModel: process.env.GOOGLE_CHAT_MODEL ?? "gemini-2.0-flash",
    autocompleteModel:
      process.env.GOOGLE_AUTOCOMPLETE_MODEL ?? "gemini-2.0-flash",
    visionModel: process.env.GOOGLE_VISION_MODEL ?? "gemini-2.0-flash",
  } satisfies AiSettings;
};

export const resolveAiSettings = (value: unknown) => {
  return parseAiSettings(value) ?? getFallbackAiSettings();
};

export const encryptAiSettings = (settings: AiSettings, secret: string) => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, deriveEncryptionKey(secret), iv);
  const payload = Buffer.from(JSON.stringify(settings), "utf8");
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
};

export const decryptAiSettings = (encryptedValue: string, secret: string) => {
  try {
    const payload = Buffer.from(encryptedValue, "base64");
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = payload.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(
      CIPHER_ALGORITHM,
      deriveEncryptionKey(secret),
      iv,
    );

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");

    return parseAiSettings(JSON.parse(decrypted));
  } catch {
    return null;
  }
};

export const getLanguageModel = (
  settings: AiSettings,
  purpose: AiModelPurpose = "chat",
) => {
  const modelId = resolveModelForPurpose(settings, purpose);

  if (settings.provider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseURL || undefined,
    });

    return google(modelId);
  }

  const provider = createOpenAICompatible({
    name: settings.provider,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.provider === "openrouter" ? getOpenRouterHeaders() : undefined,
  });

  return provider(modelId);
};

export const getVisionRequestConfig = (settings: AiSettings) => {
  const model = resolveModelForPurpose(settings, "vision");

  if (settings.provider === "google") {
    return {
      mode: "google" as const,
      model,
      apiKey: settings.apiKey,
      baseURL:
        settings.baseURL || "https://generativelanguage.googleapis.com/v1beta",
    };
  }

  return {
    mode: "openai-compatible" as const,
    model,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.provider === "openrouter" ? getOpenRouterHeaders() : undefined,
  };
};
