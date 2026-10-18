/** Remembered settings and the list of results for the workflow runner, kept on disk next to config.json (not in the browser). */
import fs from "fs";
import path from "path";

export type Kind = "image" | "video";
export interface Overrides { prompt_in?: string; output?: string }

export interface ToolConfig {
  workflowFolder: string;
  refFolder: string;
  promptFileDir: string;
  /** Where finished results go, per tab. Blank = the app's own outputs/ folder (so they show in the History gallery). */
  destination: Record<Kind, string>;
  outputFilename: Record<Kind, string>;
  lastWorkflow: Record<Kind, string>;
  /** workflow path -> the nodes the person picked as prompt / output when the app could not decide. */
  workflowRoles: Record<string, Overrides>;
}

const DEFAULTS: ToolConfig = {
  workflowFolder: "", refFolder: "", promptFileDir: "",
  destination: { image: "", video: "" }, outputFilename: { image: "", video: "" }, lastWorkflow: { image: "", video: "" },
  workflowRoles: {},
};

export interface HistoryEntry { path: string; workflow: string; prompt: string; kind: Kind; createdAt: string }
const MAX_ENTRIES = 500;
const PROMPT_SNIPPET = 200;

export function createStore(dir: string) {
  const configFile = path.join(dir, "comfy-tool.json");
  const historyFile = path.join(dir, "comfy-tool-history.json");

  const loadConfig = (): ToolConfig => {
    try {
      const d = JSON.parse(fs.readFileSync(configFile, "utf8"));
      return { ...DEFAULTS, ...d, destination: { ...DEFAULTS.destination, ...d.destination }, outputFilename: { ...DEFAULTS.outputFilename, ...d.outputFilename }, lastWorkflow: { ...DEFAULTS.lastWorkflow, ...d.lastWorkflow } };
    } catch { return structuredClone(DEFAULTS); }
  };
  // Write via a temp file + rename: several requests save at once and a plain write could hand a reader a half-written file.
  const saveConfig = (c: ToolConfig) => {
    const tmp = `${configFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
    fs.renameSync(tmp, configFile);
  };

  const readHistory = (): HistoryEntry[] => {
    try { const d = JSON.parse(fs.readFileSync(historyFile, "utf8")); return Array.isArray(d) ? d.filter(e => e && e.path) : []; } catch { return []; }
  };
  const writeHistory = (entries: HistoryEntry[]) => fs.writeFileSync(historyFile, JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2));
  const resolved = (p: string) => path.resolve(p);

  return {
    loadConfig, saveConfig,
    /** Newest first; results that no longer exist (moved or deleted outside the app) are left out. */
    history(kind?: Kind): HistoryEntry[] { return readHistory().filter(e => fs.existsSync(e.path) && (!kind || e.kind === kind)); },
    addHistory(p: string, workflow: string, prompt: string, kind: Kind) {
      const r = resolved(p);
      const entries = readHistory().filter(e => e.path !== r);
      entries.unshift({ path: r, workflow, prompt: prompt.split(/\s+/).filter(Boolean).join(" ").slice(0, PROMPT_SNIPPET), kind, createdAt: new Date().toISOString() });
      writeHistory(entries);
    },
    removeHistory(p: string) { const r = resolved(p); writeHistory(readHistory().filter(e => e.path !== r)); },
    isKnown(p: string) { const r = resolved(p); return readHistory().some(e => e.path === r); },
  };
}
