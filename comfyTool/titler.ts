/**
 * Works out which nodes of an API-format workflow play which role - prompt, output, reference-media slots,
 * negative prompt, tunable settings - by reading the graph's actual structure instead of guessing from class
 * names alone. Lets untitled workflows run without renaming anything in ComfyUI.
 *
 * - Prompt node: the text-bearing node reached by following every "positive" input upstream (through
 *   conditioning-only nodes). No "positive" wiring falls back to "the one text node"; no text node at all
 *   means the workflow takes no prompt (upscalers, face swap, 3D).
 * - Output node: the terminal save node (class contains "Save" or "VideoCombine"), else a Preview node. Several
 *   in the SAME pipeline: the most downstream wins. Several in DIFFERENT, disconnected pipelines are never
 *   auto-resolved - the person is asked.
 * - Reference slots: LoadImage / LoadVideo / LoadAudio family inside the resolved output's pipeline.
 * Anything still tied is reported rather than guessed.
 *
 * Ported from the original Python "From Prompt" tool (backend/workflow_titler.py).
 */

type Json = Record<string, any>;

const OUTPUT_CLASS_HINTS = ["save", "videocombine"];
const OUTPUT_CLASS_EXCLUDES = ["text file", "fluxtrain", "savelatent"];
const LOAD_IMAGE_CLASSES = new Set(["LoadImage", "LoadImageMask"]);
const LOAD_VIDEO_CLASSES = new Set(["VHS_LoadVideo", "LoadVideo"]);
const LOAD_AUDIO_CLASSES = new Set(["LoadAudio"]);
// The input that carries the uploaded filename differs per loader class.
const MEDIA_KEYS: Record<string, string[]> = { image: ["image"], video: ["video", "file"], audio: ["audio"] };

const PROMPT_KEYS = ["text", "prompt", "tags", "lyrics", "string", "value", "caption", "clip_l", "t5xxl"];
const NOT_PROMPT_CLASS_HINTS = ["loader", "select", "save", "show", "display", "preview", "download"];
const FILE_LIKE = /\.(safetensors|ckpt|pt|pth|gguf|bin|png|jpe?g|webp|gif|mp4|webm|mov|csv|json)$/i;
const PRIMITIVE_KINDS: Record<string, string> = {
  PrimitiveInt: "int", PrimitiveFloat: "float", PrimitiveBoolean: "bool", PrimitiveString: "text", PrimitiveStringMultiline: "text",
};
const MAX_FIELDS = 12;

// Quality / size / speed settings that live as plain inputs on well-known nodes: class -> [(input, label, kind)].
const TUNABLES: Record<string, [string, string, string][]> = {
  ResolutionSelector: [["aspect_ratio", "Aspect ratio", "select"], ["megapixels", "Resolution (megapixels)", "float"]],
  BasicScheduler: [["steps", "Steps (more = better, slower)", "int"]],
  KSampler: [["steps", "Steps (more = better, slower)", "int"], ["cfg", "CFG", "float"]],
  CreateVideo: [["fps", "Frame rate (fps)", "int"]],
};

export interface TitleSuggestion {
  promptIn: string | null;
  promptKeys: string[];
  output: string | null;
  refImages: string[];
  refVideos: string[];
  refAudios: string[];
  refKeys: Record<string, string>;
  promptCandidates: string[];
  outputCandidates: string[];
  negativePrompt: string | null;
  ambiguous: string[];
  ambiguousRoles: string[];
  /** 0 = no output found, 1 = one pipeline (normal), 2+ = this file bundles that many separate workflows. */
  workflowGroupCount: number;
}

// API-format ids are usually digits but subgraph nodes look like "119:35".
const sortKey = (id: string): [number, number, string][] => id.split(":").map(p => (/^\d+$/.test(p) ? [0, parseInt(p, 10), ""] : [1, 0, p]) as [number, number, string]);
export function compareNodeIds(a: string, b: string): number {
  const ka = sortKey(a), kb = sortKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    for (let j = 0; j < 3; j++) {
      if (ka[i][j] < kb[i][j]) return -1;
      if (ka[i][j] > kb[i][j]) return 1;
    }
  }
  return ka.length - kb.length;
}
export const sortedIds = (ids: Iterable<string>) => [...ids].sort(compareNodeIds);

export const isLink = (v: any): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === "string";

function* linkSources(node: Json): Generator<string> {
  for (const v of Object.values<any>(node.inputs || {})) if (isLink(v)) yield v[0];
}

export function ancestors(graph: Json, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const parent of linkSources(graph[cur] || {})) {
      if (parent in graph && !seen.has(parent)) { seen.add(parent); stack.push(parent); }
    }
  }
  return seen;
}

/** Every node grouped with whatever it shares a link with (links undirected) - "which pipeline is this node part of". */
function connectedComponents(graph: Json): Set<string>[] {
  const adjacency = new Map<string, Set<string>>(Object.keys(graph).map(id => [id, new Set()]));
  for (const [nid, node] of Object.entries<any>(graph)) {
    for (const parent of linkSources(node)) {
      if (adjacency.has(parent)) { adjacency.get(nid)!.add(parent); adjacency.get(parent)!.add(nid); }
    }
  }
  const seen = new Set<string>();
  const components: Set<string>[] = [];
  for (const start of Object.keys(graph)) {
    if (seen.has(start)) continue;
    const component = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (component.has(cur)) continue;
      component.add(cur);
      for (const n of adjacency.get(cur)!) if (!component.has(n)) stack.push(n);
    }
    for (const n of component) seen.add(n);
    components.push(component);
  }
  return components;
}

const looksLikePath = (value: string) => {
  const v = value.trim();
  return FILE_LIKE.test(v) || (v.includes("\\") && !v.includes(" "));
};

/** Input names on this node that hold an editable literal prompt string. */
export function textKeys(node: Json): string[] {
  const cls = String(node.class_type || "").toLowerCase();
  if (NOT_PROMPT_CLASS_HINTS.some(h => cls.includes(h))) return [];
  const inputs = node.inputs || {};
  return PROMPT_KEYS.filter(k => typeof inputs[k] === "string" && !looksLikePath(inputs[k]));
}

/** Walk upstream from each start node until reaching prompt-bearing nodes (positive side only through pairs). */
function walkToTextNodes(graph: Json, startIds: Iterable<string>): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const stack = [...startIds];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur) || !(cur in graph)) continue;
    seen.add(cur);
    const node = graph[cur];
    if (textKeys(node).length) { found.add(cur); continue; }
    const links: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(node.inputs || {})) if (isLink(v)) links[k] = v[0];
    if ("positive" in links) stack.push(links.positive);
    else if ("conditioning" in links) stack.push(links.conditioning);
    else for (const [name, target] of Object.entries(links)) if (name !== "negative") stack.push(target);
  }
  return found;
}

function sourcesOf(graph: Json, inputName: string): Set<string> {
  const out = new Set<string>();
  for (const node of Object.values<any>(graph)) {
    const v = (node.inputs || {})[inputName];
    if (isLink(v)) out.add(v[0]);
  }
  return out;
}

function outputPool(graph: Json): [string[], string[]] {
  const isSave = (n: Json) => { const c = String(n.class_type || "").toLowerCase(); return OUTPUT_CLASS_HINTS.some(h => c.includes(h)) && !OUTPUT_CLASS_EXCLUDES.some(x => c.includes(x)); };
  const isPreview = (n: Json) => { const c = String(n.class_type || "").toLowerCase(); return c.includes("preview") && !c.includes("mask"); };
  const saves = Object.keys(graph).filter(id => isSave(graph[id]));
  const previews = Object.keys(graph).filter(id => isPreview(graph[id]));
  return [saves, previews];
}

function mediaKey(node: Json, kind: string): string {
  const inputs = node.inputs || {};
  for (const key of MEDIA_KEYS[kind]) if (typeof inputs[key] === "string") return key;
  return MEDIA_KEYS[kind][0];
}

/** `outputHint`, when a node id in the graph, is trusted as the output outright (an explicit title or the person's pick). */
export function suggestTitles(graph: Json, outputHint?: string | null): TitleSuggestion {
  const result: TitleSuggestion = {
    promptIn: null, promptKeys: [], output: null, refImages: [], refVideos: [], refAudios: [], refKeys: {},
    promptCandidates: [], outputCandidates: [], negativePrompt: null, ambiguous: [], ambiguousRoles: [], workflowGroupCount: 0,
  };
  const components = connectedComponents(graph);
  const componentIndex = new Map<string, number>();
  components.forEach((comp, i) => comp.forEach(id => componentIndex.set(id, i)));

  // --- output (resolved first: everything below is scoped to whichever bundled workflow it belongs to) ---
  const [saves, previews] = outputPool(graph);
  result.outputCandidates = sortedIds([...saves, ...previews]);
  result.workflowGroupCount = new Set(result.outputCandidates.map(id => componentIndex.get(id))).size;

  if (outputHint && outputHint in graph) {
    result.output = outputHint;
  } else {
    let pool = saves.length ? saves : previews;
    const candidateComponents = new Set(pool.map(id => componentIndex.get(id)));
    if (candidateComponents.size > 1) {
      result.ambiguous.push(`this file contains ${candidateComponents.size} separate workflows (each with its own output) that aren't connected to each other - pick which one to use under 'Detected nodes'`);
      result.ambiguousRoles.push("output");
    } else if (pool.length > 1) {
      // several save points within the SAME pipeline (e.g. pre-/post-upscale): the most downstream is the final result
      const depth = new Map(pool.map(id => [id, ancestors(graph, id).size] as [string, number]));
      const deepest = Math.max(...depth.values());
      pool = pool.filter(id => depth.get(id) === deepest);
      if (pool.length === 1) result.output = pool[0];
      else { result.ambiguous.push(`${pool.length} possible output/save nodes: ${pool.join(", ")}`); result.ambiguousRoles.push("output"); }
    } else if (pool.length === 1) {
      result.output = pool[0];
    }
  }

  const scope: Json = {};
  if (result.output !== null && componentIndex.has(result.output)) {
    const comp = components[componentIndex.get(result.output)!];
    for (const [nid, node] of Object.entries<any>(graph)) if (comp.has(nid)) scope[nid] = node;
  } else {
    Object.assign(scope, graph); // output still unresolved (ambiguous) - nothing to scope to yet
  }

  // --- prompt ---
  result.promptCandidates = sortedIds(Object.keys(scope).filter(nid => textKeys(scope[nid]).length));
  const positiveOrigins = walkToTextNodes(scope, sourcesOf(scope, "positive"));
  const negativeOrigins = new Set([...walkToTextNodes(scope, sourcesOf(scope, "negative"))].filter(id => !positiveOrigins.has(id)));

  if (positiveOrigins.size === 1) {
    result.promptIn = [...positiveOrigins][0];
  } else if (positiveOrigins.size > 1) {
    result.ambiguous.push(`${positiveOrigins.size} different prompt nodes feed a 'positive' input`);
    result.ambiguousRoles.push("prompt");
  } else {
    const pool = result.promptCandidates.filter(nid => !negativeOrigins.has(nid) && !String((scope[nid]._meta || {}).title || "").toLowerCase().includes("negative"));
    if (pool.length === 1) result.promptIn = pool[0];
    else if (pool.length > 1) { result.ambiguous.push(`${pool.length} possible prompt nodes: ${pool.join(", ")}`); result.ambiguousRoles.push("prompt"); }
  }

  if (result.promptIn) {
    const keys = textKeys(scope[result.promptIn]);
    // CLIPTextEncodeFlux wants the same text in both encoders.
    result.promptKeys = keys.includes("clip_l") && keys.includes("t5xxl") ? ["clip_l", "t5xxl"] : keys.slice(0, 1);
  }
  if (negativeOrigins.size === 1) {
    const neg = [...negativeOrigins][0];
    if (neg !== result.promptIn) result.negativePrompt = neg;
  }

  // --- reference media slots ---
  for (const [kind, classes, attr] of [["image", LOAD_IMAGE_CLASSES, "refImages"], ["video", LOAD_VIDEO_CLASSES, "refVideos"], ["audio", LOAD_AUDIO_CLASSES, "refAudios"]] as const) {
    const ids = sortedIds(Object.keys(scope).filter(nid => classes.has(scope[nid].class_type)));
    result[attr] = ids;
    for (const nid of ids) result.refKeys[nid] = mediaKey(scope[nid], kind);
  }
  return result;
}

export interface WorkflowField {
  id: string; node: string; input: string; label: string; kind: string; value: any; options?: string[];
  /** Set for the picture / clip size and length controls, which get a dedicated Size & duration block in the UI. */
  role?: "width" | "height" | "length" | "fps" | "size";
  /** Frame counts must be a multiple of this plus one (LTX 8, Wan / Hunyuan 4). */
  snap?: number;
}

const SIZE_KEYS: Record<string, "width" | "height" | "length"> = { width: "width", height: "height", length: "length", num_frames: "length", video_frames: "length", frames_number: "length", frame_count: "length" };
const FPS_KEYS = new Set(["fps", "frame_rate"]);
// Nodes whose width / height / length really set the generated picture or clip (not a later resize step).
const LATENT_SIZE_CLASS = /Latent|ToVideo|FirstLastFrame|CameraEmbedding/i;
const FPS_CLASS = /CreateVideo|VideoCombine|LTXVConditioning|SaveAnimated|SaveVideo/i;
const snapFor = (cls: string) => (/LTX/i.test(cls) ? 8 : /Wan|Hunyuan|Cosmos|Mochi/i.test(cls) ? 4 : undefined);
function sizeRole(cls: string, key: string): WorkflowField["role"] | undefined {
  if (SIZE_KEYS[key] && LATENT_SIZE_CLASS.test(cls)) return SIZE_KEYS[key];
  if (FPS_KEYS.has(key) && FPS_CLASS.test(cls)) return "fps";
  if (cls === "ResolutionSelector") return "size";
  return undefined;
}

/**
 * Editable inputs worth showing when a workflow is selected, beyond the main prompt: the negative prompt,
 * further text boxes on the prompt node (lyrics next to tags), the author's own Primitive nodes (width, length,
 * fps...), and well-known quality knobs (steps, CFG, resolution). `scope` keeps it to nodes feeding the output.
 */
export function describeFields(graph: Json, promptId: string | null, negativeId: string | null, scope?: Set<string> | null, objectInfo?: Json | null): WorkflowField[] {
  const fields: WorkflowField[] = [];
  const add = (nid: string, key: string, label: string, kind: string, options?: string[], role?: WorkflowField["role"]) => {
    const id = `${nid}.${key}`;
    if (fields.some(x => x.id === id)) return;
    // Size / length / fps controls are always shown, whatever the cap on the other settings.
    if (role || fields.filter(x => !x.role).length < MAX_FIELDS) {
      const f: WorkflowField = { id, node: nid, input: key, label, kind, value: graph[nid].inputs[key] };
      if (options) f.options = options;
      if (role) { f.role = role; const sn = snapFor(String(graph[nid].class_type || "")); if (role === "length" && sn) f.snap = sn; }
      fields.push(f);
    }
  };

  // Size and length first: any width / height / length input on a latent or image-to-video node feeding the output.
  for (const nid of sortedIds(Object.keys(graph))) {
    if (scope && !scope.has(nid)) continue;
    const cls = String(graph[nid].class_type || "");
    for (const key of Object.keys(graph[nid].inputs || {})) {
      const role = sizeRole(cls, key);
      const value = graph[nid].inputs[key];
      if (!role || role === "size" || typeof value !== "number" || isLink(value)) continue;
      add(nid, key, `${key.replace(/_/g, " ")} (${cls})`, Number.isInteger(value) ? "int" : "float", undefined, role);
    }
  }

  if (negativeId) {
    const keys = textKeys(graph[negativeId]);
    if (keys.length) add(negativeId, keys[0], "Negative prompt", "text");
  }
  if (promptId) {
    const keys = textKeys(graph[promptId]);
    if (!(keys.includes("clip_l") && keys.includes("t5xxl"))) {
      for (const key of keys.slice(1)) add(promptId, key, key.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()), "text");
    }
  }

  const consumers = new Map<string, [string, string][]>();
  for (const [nid, node] of Object.entries<any>(graph)) {
    for (const [key, value] of Object.entries<any>(node.inputs || {})) {
      if (isLink(value)) { if (!consumers.has(value[0])) consumers.set(value[0], []); consumers.get(value[0])!.push([nid, key]); }
    }
  }

  for (const nid of sortedIds(Object.keys(graph))) {
    if (scope && !scope.has(nid)) continue;
    const node = graph[nid];
    const cls = String(node.class_type || "");
    if (nid === promptId || nid === negativeId) continue;
    let kind: string | undefined = PRIMITIVE_KINDS[cls];
    if (!kind && (cls.includes("StringConstant") || cls === "Simple String")) kind = "text";
    const key = "value" in (node.inputs || {}) ? "value" : "string";
    const value = (node.inputs || {})[key];
    if (!kind || value === undefined || value === null || isLink(value)) continue;
    if (kind === "text" && (typeof value !== "string" || looksLikePath(value))) continue;
    const title = (node._meta || {}).title || "";
    let label: string;
    if (title && title !== cls && title !== "Simple String") label = title;
    else if (consumers.get(nid)?.length) {
      const [target, targetInput] = consumers.get(nid)![0];
      label = `${targetInput.replace(/_/g, " ")} (${graph[target].class_type || ""})`;
    } else label = `${cls} ${nid}`;
    let role: WorkflowField["role"] | undefined;
    for (const [target, targetInput] of consumers.get(nid) || []) { role = sizeRole(String(graph[target].class_type || ""), targetInput); if (role) { if (role === "length") { const sn = snapFor(String(graph[target].class_type || "")); if (sn) { add(nid, key, label, kind, undefined, role); fields[fields.length - 1].snap = sn; role = undefined; kind = "__done"; } } break; } }
    if (kind !== "__done") add(nid, key, label, kind, undefined, role);
  }

  for (const nid of sortedIds(Object.keys(graph))) {
    if (scope && !scope.has(nid)) continue;
    const cls = String(graph[nid].class_type || "");
    for (const [key, label, kind] of TUNABLES[cls] || []) {
      const value = (graph[nid].inputs || {})[key];
      if (value === undefined || value === null || isLink(value)) continue;
      let options: string[] | undefined;
      if (kind === "select") {
        const entry = (((objectInfo || {})[cls] || {}).input || {}).required?.[key] || [null];
        // older ComfyUI: [["a", "b"], {...}]; newer: ["COMBO", {"options": ["a", "b"]}]
        options = Array.isArray(entry[0]) ? entry[0] : (entry.length > 1 && entry[1] && Array.isArray(entry[1].options) ? entry[1].options : undefined);
        if (!options || !options.length) continue; // without the choices a dropdown cannot be built
      }
      add(nid, key, label, kind, options, sizeRole(cls, key));
    }
  }
  return fields;
}
