/**
 * Reads ComfyUI workflow files (UI format from Ctrl+S, or "Save (API Format)") and works out, for each one,
 * what it needs and what it makes: runnable or not (and why), the prompt node, the output node and its kind
 * (image / video / audio / 3d), reference-media slots, and editable settings.
 *
 * Ported from the original Python "From Prompt" tool (backend/workflow_registry.py).
 */
import fs from "fs";
import path from "path";
import { convertUiWorkflow } from "./convert";
import { ancestors, describeFields, isLink, suggestTitles, textKeys, WorkflowField } from "./titler";

type Json = Record<string, any>;

// A string literal OR a /* block */ or // line comment, so a comment marker inside a string value is never mistaken for a comment.
const JSON_TOKEN = /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const GENERIC_SLOT_TITLE = /^(load[ _]?)?(image|video|audio)( ?\d+)?( \(.*\))?$/i;
const MAX_CANDIDATES = 80;
/** Role-override value meaning "this workflow takes no prompt". */
export const NO_PROMPT = "__none__";

export type OutputKind = "image" | "video" | "audio" | "3d";

/** json.parse that tolerates hand-annotated files (// and block comments) - common in workflows people edit by hand. */
export function loadWorkflowJson(file: string): any {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text.replace(JSON_TOKEN, m => (m.startsWith('"') ? m : "")));
}

export interface WorkflowInfo {
  name: string;
  path: string;
  refImageCount: number;
  isRunnable: boolean;
  missing: string[];
  promptNodeId: string | null;
  outputNodeId: string | null;
  refImageNodeIds: string[];
  refVideoCount: number;
  refVideoNodeIds: string[];
  refAudioCount: number;
  refAudioNodeIds: string[];
  /** ref node id -> the input that holds the filename */
  refKeys: Record<string, string>;
  refImageLabels: string[];
  refVideoLabels: string[];
  refAudioLabels: string[];
  /** Which slots can be individually left out of a run (a variable-length reference group). */
  refImageBypassable: boolean[];
  refVideoBypassable: boolean[];
  refAudioBypassable: boolean[];
  promptKeys: string[];
  needsPrompt: boolean;
  outputKind: OutputKind;
  fields: WorkflowField[];
  warnings: string[];
  /** Roles the person must pick: "prompt" | "output" */
  needsAssignment: string[];
  promptCandidates: { id: string; label: string }[];
  outputCandidates: { id: string; label: string }[];
  workflowGroupCount: number;
}

const blank = (name: string, p: string): WorkflowInfo => ({
  name, path: p, refImageCount: 0, isRunnable: false, missing: [], promptNodeId: null, outputNodeId: null,
  refImageNodeIds: [], refVideoCount: 0, refVideoNodeIds: [], refAudioCount: 0, refAudioNodeIds: [], refKeys: {},
  refImageLabels: [], refVideoLabels: [], refAudioLabels: [], refImageBypassable: [], refVideoBypassable: [], refAudioBypassable: [],
  promptKeys: ["text"], needsPrompt: true, outputKind: "image", fields: [], warnings: [], needsAssignment: [],
  promptCandidates: [], outputCandidates: [], workflowGroupCount: 0,
});
const unusable = (name: string, p: string, reason: string): WorkflowInfo => ({ ...blank(name, p), missing: [reason] });

function describeNode(graph: Json, id: string): string {
  const node = graph[id];
  const cls = node.class_type || "?";
  const title = (node._meta || {}).title || "";
  let label = `${id} · ${cls}` + (title && title !== cls ? ` “${title}”` : "");
  const keys = textKeys(node);
  if (keys.length) {
    const snippet = String(node.inputs[keys[0]]).split(/\s+/).filter(Boolean).join(" ").slice(0, 48);
    if (snippet) label += `: ${snippet}`;
  }
  return label;
}

function slotLabels(graph: Json, ids: string[], kind: string): string[] {
  return ids.map((nid, i) => {
    const title = (graph[nid]._meta || {}).title || "";
    const generic = !title || title === graph[nid].class_type || GENERIC_SLOT_TITLE.test(title);
    return generic ? `${kind} ${i + 1}` : title;
  });
}

/**
 * A ref loader is safely skippable on its own when the node consuming it does so through a dynamic "autogrow"
 * input group (input name contains "."): removing the loader just leaves the group shorter. A loader feeding a
 * plain fixed input has nothing to fall back to.
 */
function isBypassable(graph: Json, id: string): boolean {
  return Object.values<any>(graph).some(node =>
    Object.entries<any>(node.inputs || {}).some(([key, value]) => Array.isArray(value) && value.length === 2 && value[0] === id && key.includes(".")));
}

export function outputKindOf(classType: string): OutputKind {
  const c = classType.toLowerCase();
  if (c.includes("audio")) return "audio";
  if (c.includes("video")) return "video";
  if (c.includes("glb") || c.includes("3d") || c.includes("mesh")) return "3d";
  return "image";
}

export const isUiFormat = (data: any) => !!data && typeof data === "object" && !Array.isArray(data) && "nodes" in data && "links" in data;

/**
 * Load a workflow file as an API-format graph, whichever way ComfyUI exported it. Returns the graph and
 * `droppedTypes` (node id -> class) for nodes the converter had to drop because ComfyUI lacks that class.
 * Throws for a UI-format file when no schema is available.
 */
export function loadApiWorkflow(file: string, objectInfo: Json | null): { graph: Json; droppedTypes: Record<string, string> } {
  const data = loadWorkflowJson(file);
  if (!isUiFormat(data)) return { graph: data, droppedTypes: {} };
  if (!objectInfo) throw new Error('UI-format workflow - start ComfyUI so this app can read it (or re-save via "Save (API Format)")');
  const converted = convertUiWorkflow(data, objectInfo);
  return { graph: converted.apiWorkflow, droppedTypes: Object.fromEntries(converted.unknownTypes) };
}

export interface Overrides { prompt_in?: string; output?: string }

/** `overrides` is the person's own choice of nodes; `objectInfo` null = ComfyUI unreachable (UI files unreadable, installed-node check skipped). */
export function loadWorkflowInfo(file: string, overrides: Overrides = {}, objectInfo: Json | null = null): WorkflowInfo {
  const name = path.basename(file, path.extname(file));
  let graph: Json, droppedTypes: Record<string, string>;
  try {
    ({ graph, droppedTypes } = loadApiWorkflow(file, objectInfo));
  } catch (e: any) {
    return unusable(name, file, e instanceof SyntaxError ? "invalid JSON" : String(e.message || e));
  }
  const knownClasses = objectInfo ? new Set(Object.keys(objectInfo)) : null;

  let promptInId: string | null = null;
  let outputId: string | null = null;
  const refIds: Record<string, Record<number, string>> = { image: {}, video: {}, audio: {} };
  let suggestion: ReturnType<typeof suggestTitles>;
  // Valid JSON that isn't a ComfyUI API-format workflow (an array, or a dict whose values aren't node dicts) just
  // marks this one file unusable instead of taking the whole listing down.
  try {
    if (!graph || typeof graph !== "object" || Array.isArray(graph)) throw new TypeError("not a workflow");
    for (const [nodeId, node] of Object.entries<any>(graph)) {
      if (!node || typeof node !== "object" || Array.isArray(node)) throw new TypeError("not a workflow");
      const title: string = (node._meta || {}).title || "";
      if (title === "PROMPT_IN") promptInId = nodeId;
      else if (title === "OUTPUT") outputId = nodeId;
      else for (const kind of Object.keys(refIds)) {
        const prefix = `REF_${kind.toUpperCase()}_`;
        if (title.startsWith(prefix) && /^\d+$/.test(title.slice(prefix.length))) refIds[kind][parseInt(title.slice(prefix.length), 10)] = nodeId;
      }
    }
    // The winning output source (explicit title, then the person's pick) scopes prompt/ref detection to its pipeline.
    const outputRole = overrides.output;
    const outputHint = outputId || (outputRole && outputRole in graph ? outputRole : null);
    suggestion = suggestTitles(graph, outputHint);
  } catch {
    return unusable(name, file, "not a ComfyUI workflow");
  }

  // Precedence for every role: the person's own pick, then a node they titled in ComfyUI, then inference.
  const promptOverride = overrides.prompt_in;
  if (promptOverride === NO_PROMPT) promptInId = null;
  else if (promptOverride && promptOverride in graph) promptInId = promptOverride;
  else promptInId = promptInId || suggestion.promptIn;
  const outputRole = overrides.output;
  outputId = outputId || (outputRole && outputRole in graph ? outputRole : null) || suggestion.output;

  const ordered: Record<string, string[]> = {};
  for (const [kind, inferred] of [["image", suggestion.refImages], ["video", suggestion.refVideos], ["audio", suggestion.refAudios]] as const) {
    const explicit = Object.keys(refIds[kind]).map(Number).sort((a, b) => a - b).map(n => refIds[kind][n]);
    ordered[kind] = explicit.length ? explicit : inferred;
  }

  let promptKeys = ["text"];
  if (promptInId) {
    const keys = textKeys(graph[promptInId]);
    promptKeys = keys.includes("clip_l") && keys.includes("t5xxl") ? ["clip_l", "t5xxl"] : keys.slice(0, 1).length ? keys.slice(0, 1) : ["text"];
  }
  const negativeId = suggestion.negativePrompt !== promptInId ? suggestion.negativePrompt : null;

  // ambiguousRoles/ambiguous are appended in lockstep, so this pairs each role with the reason it couldn't be resolved.
  const ambiguousReason: Record<string, string> = {};
  suggestion.ambiguousRoles.forEach((role, i) => { ambiguousReason[role] = suggestion.ambiguous[i]; });

  const missing: string[] = [], needsAssignment: string[] = [], warnings: string[] = [];
  if (promptInId === null && suggestion.ambiguousRoles.includes("prompt") && promptOverride !== NO_PROMPT) {
    missing.push(ambiguousReason.prompt || "PROMPT_IN");
    needsAssignment.push("prompt");
  }
  if (outputId === null) {
    if (suggestion.ambiguousRoles.includes("output")) { missing.push(ambiguousReason.output || "OUTPUT"); needsAssignment.push("output"); }
    else missing.push("OUTPUT - this workflow has no Save or Preview node");
  }

  // Only the part of the graph feeding the chosen output is ever submitted, so problems elsewhere are warnings.
  const scope = outputId ? new Set([...ancestors(graph, outputId), outputId]) : new Set(Object.keys(graph));
  const dangling: [string, string, string][] = [];
  for (const [nid, node] of Object.entries<any>(graph)) {
    for (const [key, value] of Object.entries<any>(node.inputs || {})) {
      if (isLink(value) && !(value[0] in graph)) dangling.push([nid, key, value[0]]);
    }
  }
  dangling.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)); // tuple order
  let blocking = dangling.filter(d => scope.has(d[0]));
  // A dangling link to a node the converter dropped just means that custom node isn't installed - say so.
  const droppedUsed = [...new Set(blocking.filter(d => d[2] in droppedTypes).map(d => droppedTypes[d[2]]))].sort();
  if (droppedUsed.length) missing.push(`custom node(s) not installed in ComfyUI: ${droppedUsed.join(", ")}`);
  blocking = blocking.filter(d => !(d[2] in droppedTypes));
  if (blocking.length) {
    const [nid, key, target] = blocking[0];
    const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : "";
    missing.push(`incomplete workflow: node ${nid} (${graph[nid].class_type}).${key} points at node ${target}, which is missing from the file${more} - re-export it from ComfyUI`);
  }
  if (dangling.length > blocking.length) warnings.push(`${dangling.length - blocking.length} broken link(s) in branches the output doesn't use - ignored`);

  if (knownClasses) {
    const used = new Set([...scope].map(n => graph[n].class_type));
    const unknownUsed = [...used].filter(c => !knownClasses.has(c)).sort();
    const unknownOther = [...new Set(Object.values<any>(graph).map(n => n.class_type))].filter(c => !knownClasses.has(c) && !used.has(c)).sort();
    if (unknownUsed.length) missing.push(`custom node(s) not installed in ComfyUI: ${unknownUsed.join(", ")}`);
    if (unknownOther.length) warnings.push(`unused branches need custom nodes that aren't installed: ${unknownOther.join(", ")}`);
  }

  const refKeys: Record<string, string> = {};
  for (const kind of Object.keys(ordered)) for (const nid of ordered[kind]) refKeys[nid] = suggestion.refKeys[nid] || "image";

  return {
    name, path: file,
    refImageCount: ordered.image.length,
    isRunnable: missing.length === 0,
    missing,
    promptNodeId: promptInId,
    outputNodeId: outputId,
    refImageNodeIds: ordered.image,
    refVideoCount: ordered.video.length,
    refVideoNodeIds: ordered.video,
    refAudioCount: ordered.audio.length,
    refAudioNodeIds: ordered.audio,
    refKeys,
    refImageLabels: slotLabels(graph, ordered.image, "Image"),
    refVideoLabels: slotLabels(graph, ordered.video, "Video"),
    refAudioLabels: slotLabels(graph, ordered.audio, "Audio"),
    refImageBypassable: ordered.image.map(n => isBypassable(graph, n)),
    refVideoBypassable: ordered.video.map(n => isBypassable(graph, n)),
    refAudioBypassable: ordered.audio.map(n => isBypassable(graph, n)),
    promptKeys,
    needsPrompt: promptInId !== null,
    outputKind: outputId ? outputKindOf(String(graph[outputId].class_type || "")) : "image",
    fields: describeFields(graph, promptInId, negativeId, scope, objectInfo),
    warnings,
    needsAssignment,
    workflowGroupCount: suggestion.workflowGroupCount,
    promptCandidates: suggestion.promptCandidates.slice(0, MAX_CANDIDATES).map(id => ({ id, label: describeNode(graph, id) })),
    outputCandidates: suggestion.outputCandidates.slice(0, MAX_CANDIDATES).map(id => ({ id, label: describeNode(graph, id) })),
  };
}

/** Every workflow JSON under `folder`, subfolders included ("API_FORMAT/Minimal_Image" keeps same-named files apart). Hidden files are not workflows. */
export function listWorkflows(folder: string, roles: Record<string, Overrides> = {}, objectInfo: Json | null = null): WorkflowInfo[] {
  const infos: WorkflowInfo[] = [];
  const walk = (dir: string, rel: string[]) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, [...rel, e.name]);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) {
        const info = loadWorkflowInfo(full, roles[full] || {}, objectInfo);
        info.name = [...rel, e.name.replace(/\.json$/i, "")].join("/");
        infos.push(info);
      }
    }
  };
  walk(folder, []);
  return infos.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
