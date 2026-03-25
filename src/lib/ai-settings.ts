import { z } from "zod";

export const AI_SETTINGS_STORAGE_KEY = "knox.ai-settings.v1";

export const aiProviderSchema = z.enum([
  "google",
  "openai",
  "openrouter",
  "nvidia",
  "groq",
  "together",
  "custom",
]);

export type AiProvider = z.infer<typeof aiProviderSchema>;

export type AiModelPurpose = "chat" | "autocomplete" | "vision";

export const providerPresetSchema = z.object({
  label: z.string(),
  baseURL: z.string().optional(),
  apiKeyPlaceholder: z.string(),
  modelPlaceholder: z.string(),
  autocompletePlaceholder: z.string(),
  visionPlaceholder: z.string(),
  supportsNativeVision: z.boolean().default(false),
});

export const PROVIDER_PRESETS: Record<AiProvider, z.infer<typeof providerPresetSchema>> =
  {
    google: {
      label: "Google AI",
      apiKeyPlaceholder: "AIza...",
      modelPlaceholder: "gemini-2.0-flash",
      autocompletePlaceholder: "gemini-2.0-flash",
      visionPlaceholder: "gemini-2.0-flash",
      supportsNativeVision: true,
    },
    openai: {
      label: "OpenAI",
      baseURL: "https://api.openai.com/v1",
      apiKeyPlaceholder: "sk-...",
      modelPlaceholder: "gpt-4.1-mini",
      autocompletePlaceholder: "gpt-4.1-mini",
      visionPlaceholder: "gpt-4.1-mini",
      supportsNativeVision: false,
    },
    openrouter: {
      label: "OpenRouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKeyPlaceholder: "sk-or-v1-...",
      modelPlaceholder: "openrouter/auto",
      autocompletePlaceholder: "openrouter/auto",
      visionPlaceholder: "openrouter/auto",
      supportsNativeVision: false,
    },
    nvidia: {
      label: "NVIDIA NIM",
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKeyPlaceholder: "nvapi-...",
      modelPlaceholder: "meta/llama-3.1-70b-instruct",
      autocompletePlaceholder: "meta/llama-3.1-8b-instruct",
      visionPlaceholder: "meta/llama-3.2-90b-vision-instruct",
      supportsNativeVision: false,
    },
    groq: {
      label: "Groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKeyPlaceholder: "gsk_...",
      modelPlaceholder: "llama-3.3-70b-versatile",
      autocompletePlaceholder: "llama-3.1-8b-instant",
      visionPlaceholder: "llama-3.2-90b-vision-preview",
      supportsNativeVision: false,
    },
    together: {
      label: "Together",
      baseURL: "https://api.together.xyz/v1",
      apiKeyPlaceholder: "your-together-key",
      modelPlaceholder: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      autocompletePlaceholder: "Qwen/Qwen2.5-Coder-7B-Instruct",
      visionPlaceholder: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
      supportsNativeVision: false,
    },
    custom: {
      label: "Custom OpenAI-Compatible",
      apiKeyPlaceholder: "provider-specific key",
      modelPlaceholder: "provider/model-id",
      autocompletePlaceholder: "provider/model-id",
      visionPlaceholder: "provider/model-id",
      supportsNativeVision: false,
    },
  };

export const aiSettingsSchema = z.object({
  provider: aiProviderSchema,
  apiKey: z.string().trim().min(1).max(2_000),
  chatModel: z.string().trim().min(1).max(200),
  autocompleteModel: z.string().trim().max(200).optional().default(""),
  visionModel: z.string().trim().max(200).optional().default(""),
  baseURL: z.string().trim().max(2_000).optional().default(""),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const aiSettingsDraftSchema = aiSettingsSchema.partial().extend({
  provider: aiProviderSchema.optional(),
});

export type AiSettingsDraft = z.infer<typeof aiSettingsDraftSchema>;

export const getProviderBaseUrl = (
  provider: AiProvider,
  baseURL?: string | null,
) => {
  const trimmedBaseURL = baseURL?.trim();
  if (trimmedBaseURL) {
    return trimmedBaseURL;
  }

  return PROVIDER_PRESETS[provider].baseURL ?? "";
};

export const resolveModelForPurpose = (
  settings: Pick<AiSettings, "chatModel" | "autocompleteModel" | "visionModel">,
  purpose: AiModelPurpose,
) => {
  if (purpose === "autocomplete") {
    return settings.autocompleteModel.trim() || settings.chatModel.trim();
  }

  if (purpose === "vision") {
    return settings.visionModel.trim() || settings.chatModel.trim();
  }

  return settings.chatModel.trim();
};

export const getDefaultDraftForProvider = (
  provider: AiProvider,
): AiSettingsDraft => {
  const preset = PROVIDER_PRESETS[provider];

  return {
    provider,
    baseURL: preset.baseURL ?? "",
    chatModel: "",
    autocompleteModel: "",
    visionModel: "",
    apiKey: "",
  };
};

export const isAiSettingsConfigured = (
  value: AiSettingsDraft | null | undefined,
): value is AiSettings => {
  if (!value) {
    return false;
  }

  const parsed = aiSettingsSchema.safeParse({
    ...value,
    baseURL: value.provider ? getProviderBaseUrl(value.provider, value.baseURL) : "",
  });

  if (!parsed.success) {
    return false;
  }

  if (parsed.data.provider === "custom") {
    return parsed.data.baseURL.trim().length > 0;
  }

  return true;
};
