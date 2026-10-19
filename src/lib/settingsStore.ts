import type { AppSettings } from "../types";

const KEY = "cursed.settings";

/** What the person changed in Settings, kept in this browser so it is still there next time. */
export function readSavedSettings(): Partial<AppSettings> {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export function saveSettings(s: AppSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}
/** One saved setting, for code that does not have the settings object at hand (popups, sidebar). */
export function savedSetting<K extends keyof AppSettings>(key: K, fallback: AppSettings[K]): AppSettings[K] {
  const v = readSavedSettings()[key];
  return v === undefined ? fallback : (v as AppSettings[K]);
}
