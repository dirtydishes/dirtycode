import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_DARK_THEME_PRESET,
  DEFAULT_LIGHT_THEME_PRESET,
  type DarkThemePreset,
  type LightThemePreset,
} from "@t3tools/contracts/settings";
import { CLIENT_SETTINGS_STORAGE_KEY } from "~/settingsStorage";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedThemeMode = "light" | "dark";

export type ThemePresetId = LightThemePreset | DarkThemePreset;

export type AppearanceSettings = {
  lightThemePreset: LightThemePreset;
  darkThemePreset: DarkThemePreset;
  codeFontSize: number;
};

type ThemeCssTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  info: string;
  infoForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
};

type TerminalPalette = {
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

export type AppearanceThemeDefinition = {
  id: ThemePresetId;
  label: string;
  mode: ResolvedThemeMode;
  syntaxThemeName: string;
  colors: ThemeCssTokens;
  terminal: TerminalPalette;
};

export const LIGHT_THEME_OPTIONS: ReadonlyArray<{ value: LightThemePreset; label: string }> = [
  { value: "solarized-light", label: "Solarized Light" },
  { value: "one-light", label: "One Light" },
  { value: "catppuccin-latte", label: "Catppuccin Latte" },
  { value: "rose-pine-dawn", label: "Rose Pine Dawn" },
] as const;

export const DARK_THEME_OPTIONS: ReadonlyArray<{ value: DarkThemePreset; label: string }> = [
  { value: "catppuccin-frappe", label: "Catppuccin Frappe" },
  { value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "solarized-dark", label: "Solarized Dark" },
  { value: "dracula", label: "Dracula" },
  { value: "monokai", label: "Monokai" },
  { value: "nord", label: "Nord" },
] as const;

const ALL_THEMES: ReadonlyArray<AppearanceThemeDefinition> = [
  {
    id: "solarized-light",
    label: "Solarized Light",
    mode: "light",
    syntaxThemeName: "solarized-light",
    colors: {
      background: "#fdf6e3",
      foreground: "#586e75",
      card: "#fffdf4",
      cardForeground: "#586e75",
      popover: "#fffdf4",
      popoverForeground: "#586e75",
      primary: "#268bd2",
      primaryForeground: "#fdf6e3",
      secondary: "#eee8d5",
      secondaryForeground: "#657b83",
      muted: "#eee8d5",
      mutedForeground: "#839496",
      accent: "#2aa198",
      accentForeground: "#fdf6e3",
      destructive: "#dc322f",
      destructiveForeground: "#7f1d1d",
      border: "#d9cfb7",
      input: "#e7dec8",
      ring: "#268bd2",
      info: "#268bd2",
      infoForeground: "#1e3a8a",
      success: "#2aa198",
      successForeground: "#14532d",
      warning: "#b58900",
      warningForeground: "#78350f",
    },
    terminal: {
      cursor: "#268bd2",
      selectionBackground: "#93a1a133",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#657b83",
      brightRed: "#cb4b16",
      brightGreen: "#93a1a1",
      brightYellow: "#839496",
      brightBlue: "#657b83",
      brightMagenta: "#6c71c4",
      brightCyan: "#586e75",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "one-light",
    label: "One Light",
    mode: "light",
    syntaxThemeName: "one-light",
    colors: {
      background: "#fafbfc",
      foreground: "#24292f",
      card: "#ffffff",
      cardForeground: "#24292f",
      popover: "#ffffff",
      popoverForeground: "#24292f",
      primary: "#0969da",
      primaryForeground: "#ffffff",
      secondary: "#eef2f6",
      secondaryForeground: "#344054",
      muted: "#f1f5f9",
      mutedForeground: "#57606a",
      accent: "#2f81f7",
      accentForeground: "#ffffff",
      destructive: "#cf222e",
      destructiveForeground: "#7f1d1d",
      border: "#d0d7de",
      input: "#e5ebf0",
      ring: "#0969da",
      info: "#1f6feb",
      infoForeground: "#1e3a8a",
      success: "#1f883d",
      successForeground: "#14532d",
      warning: "#9a6700",
      warningForeground: "#78350f",
    },
    terminal: {
      cursor: "#0969da",
      selectionBackground: "#0969da22",
      black: "#24292f",
      red: "#cf222e",
      green: "#1f883d",
      yellow: "#9a6700",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#cfd6dd",
      brightBlack: "#57606a",
      brightRed: "#d1242f",
      brightGreen: "#2da44e",
      brightYellow: "#bf8700",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#f6f8fa",
    },
  },
  {
    id: "catppuccin-frappe",
    label: "Catppuccin Frappe",
    mode: "dark",
    syntaxThemeName: "catppuccin-frappe",
    colors: {
      background: "#303446",
      foreground: "#c6d0f5",
      card: "#292c3c",
      cardForeground: "#c6d0f5",
      popover: "#292c3c",
      popoverForeground: "#c6d0f5",
      primary: "#8caaee",
      primaryForeground: "#232634",
      secondary: "#414559",
      secondaryForeground: "#cad3f5",
      muted: "#414559",
      mutedForeground: "#a5adce",
      accent: "#ca9ee6",
      accentForeground: "#232634",
      destructive: "#e78284",
      destructiveForeground: "#fecaca",
      border: "#51576d",
      input: "#414559",
      ring: "#8caaee",
      info: "#8caaee",
      infoForeground: "#bfdbfe",
      success: "#a6d189",
      successForeground: "#bbf7d0",
      warning: "#e5c890",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#8caaee",
      selectionBackground: "#8caaee33",
      black: "#51576d",
      red: "#e78284",
      green: "#a6d189",
      yellow: "#e5c890",
      blue: "#8caaee",
      magenta: "#ca9ee6",
      cyan: "#81c8be",
      white: "#b5bfe2",
      brightBlack: "#626880",
      brightRed: "#e78284",
      brightGreen: "#a6d189",
      brightYellow: "#e5c890",
      brightBlue: "#8caaee",
      brightMagenta: "#ca9ee6",
      brightCyan: "#99d1db",
      brightWhite: "#a5adce",
    },
  },
  {
    id: "rose-pine-dawn",
    label: "Rose Pine Dawn",
    mode: "light",
    syntaxThemeName: "rose-pine-dawn",
    colors: {
      background: "#faf4ed",
      foreground: "#575279",
      card: "#fffaf3",
      cardForeground: "#575279",
      popover: "#fffaf3",
      popoverForeground: "#575279",
      primary: "#286983",
      primaryForeground: "#faf4ed",
      secondary: "#f2e9e1",
      secondaryForeground: "#575279",
      muted: "#f2e9e1",
      mutedForeground: "#797593",
      accent: "#907aa9",
      accentForeground: "#faf4ed",
      destructive: "#b4637a",
      destructiveForeground: "#7f1d1d",
      border: "#dfdad9",
      input: "#e8dfd8",
      ring: "#286983",
      info: "#56949f",
      infoForeground: "#0f3f53",
      success: "#56949f",
      successForeground: "#14532d",
      warning: "#ea9d34",
      warningForeground: "#78350f",
    },
    terminal: {
      cursor: "#286983",
      selectionBackground: "#28698322",
      black: "#575279",
      red: "#b4637a",
      green: "#56949f",
      yellow: "#ea9d34",
      blue: "#286983",
      magenta: "#907aa9",
      cyan: "#56949f",
      white: "#dfdad9",
      brightBlack: "#9893a5",
      brightRed: "#d7827e",
      brightGreen: "#56949f",
      brightYellow: "#ea9d34",
      brightBlue: "#286983",
      brightMagenta: "#907aa9",
      brightCyan: "#56949f",
      brightWhite: "#faf4ed",
    },
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    mode: "light",
    syntaxThemeName: "catppuccin-latte",
    colors: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      card: "#ffffff",
      cardForeground: "#4c4f69",
      popover: "#ffffff",
      popoverForeground: "#4c4f69",
      primary: "#1e66f5",
      primaryForeground: "#eff1f5",
      secondary: "#e6e9ef",
      secondaryForeground: "#4c4f69",
      muted: "#e6e9ef",
      mutedForeground: "#6c6f85",
      accent: "#8839ef",
      accentForeground: "#eff1f5",
      destructive: "#d20f39",
      destructiveForeground: "#7f1d1d",
      border: "#ccd0da",
      input: "#dce0e8",
      ring: "#1e66f5",
      info: "#1e66f5",
      infoForeground: "#1e3a8a",
      success: "#40a02b",
      successForeground: "#14532d",
      warning: "#df8e1d",
      warningForeground: "#78350f",
    },
    terminal: {
      cursor: "#1e66f5",
      selectionBackground: "#1e66f522",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#8839ef",
      brightCyan: "#04a5e5",
      brightWhite: "#bcc0cc",
    },
  },
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    mode: "dark",
    syntaxThemeName: "catppuccin-macchiato",
    colors: {
      background: "#24273a",
      foreground: "#cad3f5",
      card: "#1e2030",
      cardForeground: "#cad3f5",
      popover: "#1e2030",
      popoverForeground: "#cad3f5",
      primary: "#8aadf4",
      primaryForeground: "#1e2030",
      secondary: "#363a4f",
      secondaryForeground: "#cad3f5",
      muted: "#363a4f",
      mutedForeground: "#a5adcb",
      accent: "#c6a0f6",
      accentForeground: "#1e2030",
      destructive: "#ed8796",
      destructiveForeground: "#fecdd3",
      border: "#494d64",
      input: "#363a4f",
      ring: "#8aadf4",
      info: "#8aadf4",
      infoForeground: "#bfdbfe",
      success: "#a6da95",
      successForeground: "#bbf7d0",
      warning: "#eed49f",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#8aadf4",
      selectionBackground: "#8aadf433",
      black: "#494d64",
      red: "#ed8796",
      green: "#a6da95",
      yellow: "#eed49f",
      blue: "#8aadf4",
      magenta: "#c6a0f6",
      cyan: "#8bd5ca",
      white: "#b8c0e0",
      brightBlack: "#5b6078",
      brightRed: "#ed8796",
      brightGreen: "#a6da95",
      brightYellow: "#eed49f",
      brightBlue: "#8aadf4",
      brightMagenta: "#c6a0f6",
      brightCyan: "#91d7e3",
      brightWhite: "#a5adcb",
    },
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    mode: "dark",
    syntaxThemeName: "catppuccin-mocha",
    colors: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      card: "#181825",
      cardForeground: "#cdd6f4",
      popover: "#181825",
      popoverForeground: "#cdd6f4",
      primary: "#89b4fa",
      primaryForeground: "#11111b",
      secondary: "#313244",
      secondaryForeground: "#cdd6f4",
      muted: "#313244",
      mutedForeground: "#a6adc8",
      accent: "#cba6f7",
      accentForeground: "#11111b",
      destructive: "#f38ba8",
      destructiveForeground: "#fecdd3",
      border: "#45475a",
      input: "#313244",
      ring: "#89b4fa",
      info: "#89b4fa",
      infoForeground: "#bfdbfe",
      success: "#a6e3a1",
      successForeground: "#bbf7d0",
      warning: "#f9e2af",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#89b4fa",
      selectionBackground: "#89b4fa33",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#cba6f7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#cba6f7",
      brightCyan: "#89dceb",
      brightWhite: "#a6adc8",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    mode: "dark",
    syntaxThemeName: "solarized-dark",
    colors: {
      background: "#002b36",
      foreground: "#93a1a1",
      card: "#073642",
      cardForeground: "#93a1a1",
      popover: "#073642",
      popoverForeground: "#93a1a1",
      primary: "#268bd2",
      primaryForeground: "#fdf6e3",
      secondary: "#0b3c49",
      secondaryForeground: "#93a1a1",
      muted: "#0b3c49",
      mutedForeground: "#839496",
      accent: "#2aa198",
      accentForeground: "#fdf6e3",
      destructive: "#dc322f",
      destructiveForeground: "#fecaca",
      border: "#174854",
      input: "#0f3a45",
      ring: "#268bd2",
      info: "#268bd2",
      infoForeground: "#bfdbfe",
      success: "#859900",
      successForeground: "#bbf7d0",
      warning: "#b58900",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#268bd2",
      selectionBackground: "#93a1a133",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#657b83",
      brightRed: "#cb4b16",
      brightGreen: "#93a1a1",
      brightYellow: "#839496",
      brightBlue: "#657b83",
      brightMagenta: "#6c71c4",
      brightCyan: "#586e75",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    mode: "dark",
    syntaxThemeName: "dracula",
    colors: {
      background: "#282a36",
      foreground: "#f8f8f2",
      card: "#21222c",
      cardForeground: "#f8f8f2",
      popover: "#21222c",
      popoverForeground: "#f8f8f2",
      primary: "#bd93f9",
      primaryForeground: "#f8f8f2",
      secondary: "#343746",
      secondaryForeground: "#f8f8f2",
      muted: "#343746",
      mutedForeground: "#a4acc4",
      accent: "#ff79c6",
      accentForeground: "#1b1f2a",
      destructive: "#ff5555",
      destructiveForeground: "#fecaca",
      border: "#44475a",
      input: "#343746",
      ring: "#bd93f9",
      info: "#8be9fd",
      infoForeground: "#bfdbfe",
      success: "#50fa7b",
      successForeground: "#bbf7d0",
      warning: "#f1fa8c",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#ff79c6",
      selectionBackground: "#bd93f944",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "monokai",
    label: "Monokai",
    mode: "dark",
    syntaxThemeName: "monokai",
    colors: {
      background: "#272822",
      foreground: "#f8f8f2",
      card: "#1f201b",
      cardForeground: "#f8f8f2",
      popover: "#1f201b",
      popoverForeground: "#f8f8f2",
      primary: "#66d9ef",
      primaryForeground: "#11120e",
      secondary: "#3a3b34",
      secondaryForeground: "#f8f8f2",
      muted: "#3a3b34",
      mutedForeground: "#b7b8b1",
      accent: "#a6e22e",
      accentForeground: "#11120e",
      destructive: "#f92672",
      destructiveForeground: "#fecdd3",
      border: "#4c4d45",
      input: "#3a3b34",
      ring: "#66d9ef",
      info: "#66d9ef",
      infoForeground: "#bfdbfe",
      success: "#a6e22e",
      successForeground: "#bbf7d0",
      warning: "#fd971f",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#66d9ef",
      selectionBackground: "#66d9ef33",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#f92672",
      brightGreen: "#a6e22e",
      brightYellow: "#f4bf75",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    syntaxThemeName: "nord",
    colors: {
      background: "#2e3440",
      foreground: "#eceff4",
      card: "#242933",
      cardForeground: "#eceff4",
      popover: "#242933",
      popoverForeground: "#eceff4",
      primary: "#88c0d0",
      primaryForeground: "#2e3440",
      secondary: "#3b4252",
      secondaryForeground: "#e5e9f0",
      muted: "#3b4252",
      mutedForeground: "#d8dee9",
      accent: "#81a1c1",
      accentForeground: "#eceff4",
      destructive: "#bf616a",
      destructiveForeground: "#fecaca",
      border: "#4c566a",
      input: "#434c5e",
      ring: "#88c0d0",
      info: "#81a1c1",
      infoForeground: "#bfdbfe",
      success: "#a3be8c",
      successForeground: "#bbf7d0",
      warning: "#ebcb8b",
      warningForeground: "#fde68a",
    },
    terminal: {
      cursor: "#88c0d0",
      selectionBackground: "#81a1c144",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
] as const;

const THEME_BY_ID = new Map<ThemePresetId, AppearanceThemeDefinition>(
  ALL_THEMES.map((theme) => [theme.id, theme]),
);

const LIGHT_THEME_SET = new Set<string>(LIGHT_THEME_OPTIONS.map((option) => option.value));
const DARK_THEME_SET = new Set<string>(DARK_THEME_OPTIONS.map((option) => option.value));

function isLightThemePreset(value: unknown): value is LightThemePreset {
  return typeof value === "string" && LIGHT_THEME_SET.has(value);
}

function isDarkThemePreset(value: unknown): value is DarkThemePreset {
  return typeof value === "string" && DARK_THEME_SET.has(value);
}

export const ALL_SYNTAX_THEME_NAMES = Array.from(
  new Set(ALL_THEMES.map((theme) => theme.syntaxThemeName)),
);

export function clampCodeFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CODE_FONT_SIZE;
  return Math.max(11, Math.min(20, Math.round(value)));
}

export function readStoredAppearanceSettings(): AppearanceSettings {
  const fallback: AppearanceSettings = {
    lightThemePreset: DEFAULT_LIGHT_THEME_PRESET,
    darkThemePreset: DEFAULT_DARK_THEME_PRESET,
    codeFontSize: DEFAULT_CODE_FONT_SIZE,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    const candidate = parsed as Record<string, unknown>;
    const lightThemePreset = isLightThemePreset(candidate.lightThemePreset)
      ? candidate.lightThemePreset
      : fallback.lightThemePreset;
    const darkThemePreset = isDarkThemePreset(candidate.darkThemePreset)
      ? candidate.darkThemePreset
      : fallback.darkThemePreset;
    const codeFontSize = clampCodeFontSize(
      typeof candidate.codeFontSize === "number" ? candidate.codeFontSize : fallback.codeFontSize,
    );

    return {
      lightThemePreset,
      darkThemePreset,
      codeFontSize,
    };
  } catch {
    return fallback;
  }
}

export function resolveThemePresetForMode(
  mode: ResolvedThemeMode,
  appearance: AppearanceSettings,
): ThemePresetId {
  return mode === "dark" ? appearance.darkThemePreset : appearance.lightThemePreset;
}

export function getThemeDefinition(themeId: ThemePresetId): AppearanceThemeDefinition {
  return THEME_BY_ID.get(themeId) ?? THEME_BY_ID.get(DEFAULT_DARK_THEME_PRESET)!;
}

export function resolveAppearanceTheme(
  mode: ResolvedThemeMode,
  appearance: AppearanceSettings,
): AppearanceThemeDefinition {
  return getThemeDefinition(resolveThemePresetForMode(mode, appearance));
}

export function applyAppearanceTheme(theme: AppearanceThemeDefinition, codeFontSize: number): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.style.setProperty("--background", theme.colors.background);
  root.style.setProperty("--foreground", theme.colors.foreground);
  root.style.setProperty("--card", theme.colors.card);
  root.style.setProperty("--card-foreground", theme.colors.cardForeground);
  root.style.setProperty("--popover", theme.colors.popover);
  root.style.setProperty("--popover-foreground", theme.colors.popoverForeground);
  root.style.setProperty("--primary", theme.colors.primary);
  root.style.setProperty("--primary-foreground", theme.colors.primaryForeground);
  root.style.setProperty("--secondary", theme.colors.secondary);
  root.style.setProperty("--secondary-foreground", theme.colors.secondaryForeground);
  root.style.setProperty("--muted", theme.colors.muted);
  root.style.setProperty("--muted-foreground", theme.colors.mutedForeground);
  root.style.setProperty("--accent", theme.colors.accent);
  root.style.setProperty("--accent-foreground", theme.colors.accentForeground);
  root.style.setProperty("--destructive", theme.colors.destructive);
  root.style.setProperty("--destructive-foreground", theme.colors.destructiveForeground);
  root.style.setProperty("--border", theme.colors.border);
  root.style.setProperty("--input", theme.colors.input);
  root.style.setProperty("--ring", theme.colors.ring);
  root.style.setProperty("--info", theme.colors.info);
  root.style.setProperty("--info-foreground", theme.colors.infoForeground);
  root.style.setProperty("--success", theme.colors.success);
  root.style.setProperty("--success-foreground", theme.colors.successForeground);
  root.style.setProperty("--warning", theme.colors.warning);
  root.style.setProperty("--warning-foreground", theme.colors.warningForeground);
  root.style.setProperty("--code-font-size", `${clampCodeFontSize(codeFontSize)}px`);
}
