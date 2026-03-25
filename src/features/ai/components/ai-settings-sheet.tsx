"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AiProvider,
  AiSettingsDraft,
  PROVIDER_PRESETS,
  aiSettingsSchema,
  getDefaultDraftForProvider,
  getProviderBaseUrl,
} from "@/lib/ai-settings";
import { useAiSettings } from "@/features/ai/provider/ai-settings-provider";

type AiSettingsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const providerOptions = Object.entries(PROVIDER_PRESETS) as Array<
  [AiProvider, (typeof PROVIDER_PRESETS)[AiProvider]]
>;

export const AiSettingsSheet = ({
  open,
  onOpenChange,
}: AiSettingsSheetProps) => {
  const { draft, updateDraft, resetDraft } = useAiSettings();
  const [localDraft, setLocalDraft] = useState<AiSettingsDraft>(draft);

  const provider = localDraft.provider ?? "openrouter";
  const preset = PROVIDER_PRESETS[provider];

  const updateField = <K extends keyof AiSettingsDraft>(
    key: K,
    value: AiSettingsDraft[K],
  ) => {
    setLocalDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleProviderChange = (nextProvider: AiProvider) => {
    const nextPreset = PROVIDER_PRESETS[nextProvider];

    setLocalDraft((current) => {
      const currentProvider = current.provider;
      const currentPreset = currentProvider
        ? PROVIDER_PRESETS[currentProvider]
        : undefined;
      const shouldReplaceBaseURL =
        !current.baseURL ||
        current.baseURL === currentPreset?.baseURL ||
        currentProvider === nextProvider;

      return {
        ...current,
        provider: nextProvider,
        baseURL: shouldReplaceBaseURL ? nextPreset.baseURL ?? "" : current.baseURL,
      };
    });
  };

  const handleSave = () => {
    const normalizedDraft = {
      ...localDraft,
      provider,
      baseURL: getProviderBaseUrl(provider, localDraft.baseURL),
    };
    const parsed = aiSettingsSchema.safeParse(normalizedDraft);

    if (!parsed.success) {
      toast.error("Fill in provider, API key, and chat model before saving.");
      return;
    }

    if (parsed.data.provider === "custom" && !parsed.data.baseURL.trim()) {
      toast.error("Custom providers need a base URL.");
      return;
    }

    updateDraft(parsed.data);
    toast.success("AI provider settings saved locally.");
    onOpenChange(false);
  };

  const handleSheetOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setLocalDraft(draft);
    }

    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>AI provider</SheetTitle>
          <SheetDescription>
            Stored only in this browser. No database changes required.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div className="grid gap-2">
            <Label htmlFor="ai-provider">Provider</Label>
            <Select value={provider} onValueChange={(value) => handleProviderChange(value as AiProvider)}>
              <SelectTrigger id="ai-provider" className="w-full">
                <SelectValue placeholder="Choose a provider" />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map(([value, option]) => (
                  <SelectItem key={value} value={value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-api-key">API key</Label>
            <Input
              id="ai-api-key"
              type="password"
              placeholder={preset.apiKeyPlaceholder}
              value={localDraft.apiKey ?? ""}
              onChange={(event) => updateField("apiKey", event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-base-url">Base URL</Label>
            <Input
              id="ai-base-url"
              placeholder={preset.baseURL ?? "https://provider.example.com/v1"}
              value={localDraft.baseURL ?? ""}
              onChange={(event) => updateField("baseURL", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave as-is for known providers. Change it only for proxies or custom compatible endpoints.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-chat-model">Chat and agent model</Label>
            <Input
              id="ai-chat-model"
              placeholder={preset.modelPlaceholder}
              value={localDraft.chatModel ?? ""}
              onChange={(event) => updateField("chatModel", event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-autocomplete-model">Autocomplete model</Label>
            <Input
              id="ai-autocomplete-model"
              placeholder={preset.autocompletePlaceholder}
              value={localDraft.autocompleteModel ?? ""}
              onChange={(event) =>
                updateField("autocompleteModel", event.target.value)
              }
            />
            <p className="text-xs text-muted-foreground">
              Optional. Falls back to the chat model when left blank.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-vision-model">Vision model</Label>
            <Input
              id="ai-vision-model"
              placeholder={preset.visionPlaceholder}
              value={localDraft.visionModel ?? ""}
              onChange={(event) => updateField("visionModel", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Used for screenshot and image prompts. Falls back to the chat model.
            </p>
          </div>
        </div>

        <SheetFooter className="border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              resetDraft();
              setLocalDraft(getDefaultDraftForProvider("openrouter"));
              toast.success("Local AI provider settings cleared.");
            }}
          >
            Clear
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
