import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  applyAppearanceTheme,
  readStoredAppearanceSettings,
  resolveAppearanceTheme,
  type ThemeMode,
} from "~/theme/appearance";
import {
  CLIENT_SETTINGS_STORAGE_KEY,
  LOCAL_STORAGE_CHANGE_EVENT,
  THEME_MODE_STORAGE_KEY,
} from "~/settingsStorage";

type ThemeSnapshot = {
  theme: ThemeMode;
  systemDark: boolean;
  appearanceKey: string;
};

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: ThemeMode | null = null;

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function getSystemDark(): boolean {
  return window.matchMedia(MEDIA_QUERY).matches;
}

function getStoredThemeMode(): ThemeMode {
  const raw = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return "system";
}

function applyTheme(theme: ThemeMode, suppressTransitions = false) {
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }

  const isDark = theme === "dark" || (theme === "system" && getSystemDark());
  const resolvedTheme = isDark ? "dark" : "light";
  const appearance = readStoredAppearanceSettings();
  const appearanceTheme = resolveAppearanceTheme(resolvedTheme, appearance);

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.setProperty("color-scheme", resolvedTheme);
  applyAppearanceTheme(appearanceTheme, appearance.codeFontSize);
  syncDesktopTheme(theme);

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal.
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(theme: ThemeMode) {
  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to prevent flash.
applyTheme(getStoredThemeMode());

function getSnapshot(): ThemeSnapshot {
  const theme = getStoredThemeMode();
  const systemDark = theme === "system" ? getSystemDark() : false;
  const appearance = readStoredAppearanceSettings();
  const appearanceKey = `${appearance.lightThemePreset}:${appearance.darkThemePreset}:${appearance.codeFontSize}`;

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.appearanceKey === appearanceKey
  ) {
    return lastSnapshot;
  }

  lastSnapshot = {
    theme,
    systemDark,
    appearanceKey,
  };

  return lastSnapshot;
}

interface LocalStorageChangeDetail {
  key: string;
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);

  const mq = window.matchMedia(MEDIA_QUERY);
  const handleModeOrAppearanceChange = () => {
    applyTheme(getStoredThemeMode(), true);
    emitChange();
  };

  const handleMediaChange = () => {
    if (getStoredThemeMode() === "system") {
      handleModeOrAppearanceChange();
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_MODE_STORAGE_KEY || event.key === CLIENT_SETTINGS_STORAGE_KEY) {
      handleModeOrAppearanceChange();
    }
  };

  const handleLocalStorageChange = (event: Event) => {
    const customEvent = event as CustomEvent<LocalStorageChangeDetail>;
    const changedKey = customEvent.detail?.key;
    if (changedKey === THEME_MODE_STORAGE_KEY || changedKey === CLIENT_SETTINGS_STORAGE_KEY) {
      handleModeOrAppearanceChange();
    }
  };

  mq.addEventListener("change", handleMediaChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalStorageChange);

  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
    mq.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalStorageChange);
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const theme = snapshot.theme;

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const appearance = readStoredAppearanceSettings();
  const resolvedAppearanceTheme = resolveAppearanceTheme(resolvedTheme, appearance);

  const setTheme = useCallback((next: ThemeMode) => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, next);
    applyTheme(next, true);
    emitChange();
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, snapshot.appearanceKey]);

  return {
    theme,
    setTheme,
    resolvedTheme,
    resolvedAppearanceTheme,
    resolvedSyntaxThemeName: resolvedAppearanceTheme.syntaxThemeName,
  } as const;
}
