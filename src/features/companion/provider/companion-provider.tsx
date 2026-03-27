"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getDefaultCompanionSettings,
  type CompanionSettings,
} from "@/lib/companion";
import {
  getCompanionHealth,
  loadCompanionSettings,
  saveCompanionSettings,
} from "@/lib/companion-client";

type ConnectionState = "idle" | "checking" | "connected" | "disconnected";

type CompanionContextValue = {
  settings: CompanionSettings;
  connectionState: ConnectionState;
  lastError: string | null;
  updateSettings: (settings: CompanionSettings) => void;
  refreshHealth: () => Promise<void>;
};

const CompanionContext = createContext<CompanionContextValue | null>(null);

export const CompanionProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<CompanionSettings>(
    getDefaultCompanionSettings(),
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const syncFromStorage = () => {
      setSettings(loadCompanionSettings());
    };

    syncFromStorage();
    window.addEventListener("knox:companion-settings-updated", syncFromStorage);

    return () => {
      window.removeEventListener(
        "knox:companion-settings-updated",
        syncFromStorage,
      );
    };
  }, []);

  const refreshHealth = useCallback(async () => {
    setConnectionState("checking");
    try {
      await getCompanionHealth(settings);
      setConnectionState("connected");
      setLastError(null);
    } catch (error) {
      setConnectionState("disconnected");
      setLastError(error instanceof Error ? error.message : "Companion unavailable");
    }
  }, [settings]);

  useEffect(() => {
    if (!settings.baseUrl.trim()) {
      return;
    }

    let isCancelled = false;

    const checkHealth = async () => {
      setConnectionState("checking");
      try {
        await getCompanionHealth(settings);
        if (!isCancelled) {
          setConnectionState("connected");
          setLastError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setConnectionState("disconnected");
          setLastError(
            error instanceof Error ? error.message : "Companion unavailable",
          );
        }
      }
    };

    const initialTimeoutId = window.setTimeout(() => {
      void checkHealth();
    }, 0);

    const intervalId = window.setInterval(() => {
      void checkHealth();
    }, 15_000);

    return () => {
      isCancelled = true;
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [settings]);

  const effectiveConnectionState = settings.baseUrl.trim()
    ? connectionState
    : "idle";

  const updateCompanionSettings = useCallback((nextSettings: CompanionSettings) => {
    setSettings(nextSettings);
    saveCompanionSettings(nextSettings);
  }, []);

  const value = useMemo<CompanionContextValue>(
    () => ({
      settings,
      connectionState: effectiveConnectionState,
      lastError,
      updateSettings: updateCompanionSettings,
      refreshHealth,
    }),
    [effectiveConnectionState, lastError, refreshHealth, settings, updateCompanionSettings],
  );

  return (
    <CompanionContext.Provider value={value}>
      {children}
    </CompanionContext.Provider>
  );
};

export const useCompanion = () => {
  const context = useContext(CompanionContext);
  if (!context) {
    throw new Error("useCompanion must be used within a CompanionProvider");
  }

  return context;
};
