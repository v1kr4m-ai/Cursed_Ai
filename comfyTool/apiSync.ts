/**
 * Keeps each workflow's API copy (API_FORMAT/<same name>.json) in step with the version ComfyUI's editor saves.
 * A missing copy is made. After that, a copy is made again only when the editor's file changes: the editor file's
 * time is remembered (API_FORMAT/.api-sync.json), so copies that were there before - possibly made by hand - are
 * never overwritten just for being older. `remakeApiCopy` rebuilds one on request.
 * Copies are made with the app's converter, so they need ComfyUI's node list (live, or the saved copy).
 */
import fs from "fs";
import path from "path";
import { convertUiWorkflow } from "./convert";
import { isUiFormat } from "./registry";

type Json = any;

export interface SyncResult { made: string[]; updated: string[]; failed: { name: string; error: string }[] }

const stateFile = (apiDir: string) => path.join(apiDir, ".api-sync.json");
const readState = (apiDir: string): Record<string, number> => { try { return JSON.parse(fs.readFileSync(stateFile(apiDir), "utf8")); } catch { return {}; } };

function writeCopy(ui: string, api: string, objectInfo: Json): boolean {
  const data = JSON.parse(fs.readFileSync(ui, "utf8"));
  if (!isUiFormat(data) || !Array.isArray(data.nodes) || !data.nodes.length) return false;
  const r = convertUiWorkflow(data, objectInfo);
  if (!Object.keys(r.apiWorkflow).length) return false;
  fs.mkdirSync(path.dirname(api), { recursive: true });
  fs.writeFileSync(api, JSON.stringify(r.apiWorkflow, null, 2));
  return true;
}

export function syncApiCopies(folder: string, objectInfo: Json | null): SyncResult {
  const out: SyncResult = { made: [], updated: [], failed: [] };
  if (!objectInfo || !folder || !fs.existsSync(folder)) return out;
  const apiDir = path.join(folder, "API_FORMAT");
  const state = readState(apiDir);
  let changed = false;
  for (const f of fs.readdirSync(folder)) {
    if (!f.toLowerCase().endsWith(".json") || f.startsWith(".")) continue;
    const ui = path.join(folder, f), api = path.join(apiDir, f);
    try {
      const uiTime = Math.round(fs.statSync(ui).mtimeMs);
      const hasApi = fs.existsSync(api);
      if (hasApi && state[f] === undefined) { state[f] = uiTime; changed = true; continue; } // first sight: remember, do not touch
      if (hasApi && uiTime <= state[f]) continue;
      if (writeCopy(ui, api, objectInfo)) (hasApi ? out.updated : out.made).push(f.slice(0, -5));
      state[f] = uiTime; changed = true;
    } catch (e: any) { out.failed.push({ name: f.slice(0, -5), error: e?.message || String(e) }); }
  }
  if (changed) { fs.mkdirSync(apiDir, { recursive: true }); fs.writeFileSync(stateFile(apiDir), JSON.stringify(state, null, 1)); }
  return out;
}

/** Rebuilds one workflow's API copy from the editor's version (`file` may be either of the two). */
export function remakeApiCopy(file: string, objectInfo: Json | null): string {
  if (!objectInfo) throw new Error("Start ComfyUI once so its node list is known.");
  const name = path.basename(file);
  const folder = path.basename(path.dirname(file)) === "API_FORMAT" ? path.dirname(path.dirname(file)) : path.dirname(file);
  const ui = path.join(folder, name), api = path.join(folder, "API_FORMAT", name);
  if (!fs.existsSync(ui)) throw new Error("There is no editor version of this workflow to make the copy from.");
  if (!writeCopy(ui, api, objectInfo)) throw new Error("That file is not a workflow in ComfyUI's editor format.");
  const apiDir = path.dirname(api);
  const state = readState(apiDir);
  state[name] = Math.round(fs.statSync(ui).mtimeMs);
  fs.writeFileSync(stateFile(apiDir), JSON.stringify(state, null, 1));
  return api;
}
