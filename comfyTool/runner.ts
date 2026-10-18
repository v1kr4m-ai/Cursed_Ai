/**
 * Runs a workflow on ComfyUI: uploads the reference media, writes the prompt / reference filenames / edited
 * settings (and a fresh seed) into a copy of the graph, sends only the branch that feeds the chosen output,
 * streams live progress and preview frames over ComfyUI's websocket, and saves the finished file to the
 * destination folder under the requested name.
 *
 * Ported from the original Python "From Prompt" tool (backend/comfy_client.py).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { WorkflowInfo } from "./registry";

type Json = Record<string, any>;
export type RunEvent = { type: string; [k: string]: any };
export type EventSink = (event: RunEvent) => void;

/** Field values arrive from a web form as strings; give ComfyUI the real type the node input expects. */
function coerce(value: any, kind: string): any {
  if (kind === "int") return Math.trunc(Number(value));
  if (kind === "float") return Number(value);
  if (kind === "bool") return typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
  return String(value); // "text" and "select"
}

/** Take a reference loader out of the graph entirely (bypass one slot for a single run), scrubbing links that pointed at it. */
function removeRefNode(graph: Json, nodeId: string) {
  delete graph[nodeId];
  for (const node of Object.values<any>(graph)) {
    for (const [key, value] of Object.entries<any>(node.inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && value[0] === nodeId) delete node.inputs[key];
    }
  }
}

export interface InjectArgs {
  workflow: Json;
  info: WorkflowInfo;
  promptText: string;
  refImageFilenames: string[];
  refVideoFilenames?: string[];
  refAudioFilenames?: string[];
  fieldValues?: Record<string, any>;
  randomizeSeed?: boolean;
}

/**
 * A deep copy of `workflow` with the prompt, reference filenames, edited settings and (optionally) fresh seeds set.
 * A falsy filename bypasses that one slot for this run (the loader node is removed rather than sent empty).
 */
export function injectWorkflow(a: InjectArgs): Json {
  const { info } = a;
  const video = a.refVideoFilenames || [], audio = a.refAudioFilenames || [];
  for (const [noun, needed, got] of [["ref image", info.refImageNodeIds, a.refImageFilenames], ["ref video", info.refVideoNodeIds, video], ["ref audio", info.refAudioNodeIds, audio]] as const) {
    if (got.length !== needed.length) throw new Error(`expected ${needed.length} ${noun}(s), got ${got.length}`);
  }
  const result: Json = JSON.parse(JSON.stringify(a.workflow));
  if (info.promptNodeId !== null) for (const key of info.promptKeys) result[info.promptNodeId].inputs[key] = a.promptText;

  for (const [ids, names, defaultKey] of [[info.refImageNodeIds, a.refImageFilenames, "image"], [info.refVideoNodeIds, video, "video"], [info.refAudioNodeIds, audio, "audio"]] as const) {
    ids.forEach((nodeId, i) => {
      if (!names[i]) { removeRefNode(result, nodeId); return; }
      result[nodeId].inputs[info.refKeys[nodeId] || defaultKey] = names[i];
    });
  }

  const known = new Map(info.fields.map(f => [f.id, f]));
  for (const [fieldId, value] of Object.entries(a.fieldValues || {})) {
    const spec = known.get(fieldId);
    if (spec && spec.node in result) result[spec.node].inputs[spec.input] = coerce(value, spec.kind);
  }

  if (a.randomizeSeed) {
    // ComfyUI skips nodes whose inputs are unchanged since the last run (cache hit), so a repeat run with the same
    // seed would produce nothing new. A fresh seed on every run avoids that.
    for (const node of Object.values<any>(result)) {
      for (const key of ["seed", "noise_seed"]) {
        const v = node.inputs?.[key];
        if (typeof v === "number" && Number.isInteger(v)) node.inputs[key] = Math.floor(Math.random() * 2 ** 48);
      }
    }
  }
  return result;
}

/** Keep only the chosen output node and everything it depends on. */
export function pruneToOutput(graph: Json, outputNodeId: string | null): Json {
  if (outputNodeId === null || !(outputNodeId in graph)) return graph;
  const keep = new Set<string>();
  const stack = [outputNodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (keep.has(cur) || !(cur in graph)) continue;
    keep.add(cur);
    for (const v of Object.values<any>(graph[cur].inputs || {})) if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") stack.push(v[0]);
  }
  return Object.fromEntries(Object.entries(graph).filter(([id]) => keep.has(id)));
}

/** Upload a local file (image / video / audio) to ComfyUI; returns the filename it assigned. */
export async function uploadFile(baseUrl: string, filePath: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const resp = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`Uploading ${path.basename(filePath)} to ComfyUI failed (HTTP ${resp.status})`);
  return ((await resp.json()) as any).name;
}

const short = (text: any, limit = 220) => { const t = String(text).split(/\s+/).filter(Boolean).join(" "); return t.length <= limit ? t : t.slice(0, limit) + "..."; };

/** Turn ComfyUI's /prompt 4xx response into the actual reason (missing model, missing node, bad value...). */
async function describeRejection(resp: Response): Promise<string> {
  const raw = await resp.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return `ComfyUI rejected the workflow (HTTP ${resp.status}): ${short(raw)}`; }
  const error = body.error;
  const headline = error && typeof error === "object" ? error.message : error;
  const lines = [short(headline || `HTTP ${resp.status}`)];
  for (const [nodeId, info] of Object.entries<any>(body.node_errors || {})) {
    for (const err of info.errors || []) {
      let detail = err.details || err.message || err.type || "";
      detail = String(detail).replace(/\s+not in \[[\s\S]*/, " - not installed in ComfyUI"); // drop the list of every installed model, keep the name
      lines.push(`node ${nodeId} (${info.class_type || "?"}): ${short(detail)}`);
    }
  }
  return "ComfyUI rejected the workflow: " + lines.join("; ");
}

export async function submitWorkflow(baseUrl: string, workflow: Json, clientId: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: clientId }) });
  } catch (e: any) {
    throw new Error(`Cannot reach ComfyUI at ${baseUrl} - is it running? (${e.cause?.code || e.name})`);
  }
  if (!resp.ok) throw new Error(await describeRejection(resp));
  return ((await resp.json()) as any).prompt_id;
}

/** ComfyUI_<input image/video name>_<YYYYMMDD_HHMMSS>, or the workflow's name when it has no input file. No extension (the real one comes from the file ComfyUI made). */
export function autoOutputName(inputPaths: string[], fallback: string, now = new Date()): string {
  const first = inputPaths.find(p => p);
  const source = first ? path.basename(first, path.extname(first)) : fallback || "output";
  const cleaned = source.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "").replace(/\./g, "_").trim().replace(/^[ _]+|[ _]+$/g, "").replace(/\s+/g, "_").slice(0, 60).replace(/^_+|_+$/g, "") || "output";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `ComfyUI_${cleaned}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Never overwrite an earlier result: append a timestamp (and a counter on the rare same-second collision). */
export function uniqueDestination(dest: string): string {
  if (!fs.existsSync(dest)) return dest;
  const { dir, name, ext } = path.parse(dest);
  const n = new Date(), pad = (x: number) => String(x).padStart(2, "0");
  const stamp = `${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}_${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
  let candidate = path.join(dir, `${name}_${stamp}${ext}`);
  for (let counter = 2; fs.existsSync(candidate); counter++) candidate = path.join(dir, `${name}_${stamp}_${counter}${ext}`);
  return candidate;
}

const PREFERRED_OUTPUT_KEYS = ["images", "gifs", "videos", "audio", "3d"];
function* outputItems(outputData: Json): Generator<Json> {
  const keys = [...PREFERRED_OUTPUT_KEYS, ...Object.keys(outputData).filter(k => !PREFERRED_OUTPUT_KEYS.includes(k))];
  for (const key of keys) for (const item of outputData[key] || []) if (item && typeof item === "object" && item.filename) yield item;
}

/** Fetch the first file ComfyUI reports for the output node (via its /view API - no need to know its folders) and save it as destFolder/destFilename. The extension is the real file's. */
async function saveFirstOutput(baseUrl: string, outputData: Json, destFolder: string, destFilename: string): Promise<string> {
  for (const item of outputItems(outputData)) {
    const params = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" });
    const resp = await fetch(`${baseUrl}/view?${params}`);
    if (!resp.ok) throw new Error(`Could not fetch the result from ComfyUI (HTTP ${resp.status})`);
    const srcExt = path.extname(item.filename);
    let dest = path.join(destFolder, destFilename);
    if (srcExt && path.extname(dest).toLowerCase() !== srcExt.toLowerCase()) dest = path.join(path.dirname(dest), path.parse(dest).name + srcExt);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    dest = uniqueDestination(dest);
    fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
    return dest;
  }
  throw new Error("the output node produced no file this app recognizes");
}

/** Stop one specific prompt in ComfyUI without disturbing any other job: a queued one is removed by id, a running one is interrupted by id. */
export async function cancelPrompt(baseUrl: string, promptId: string): Promise<"removed" | "interrupted" | "not found"> {
  const queue: any = await (await fetch(`${baseUrl}/queue`, { signal: AbortSignal.timeout(10000) })).json();
  const pending = new Set((queue.queue_pending || []).map((i: any) => i[1]));
  const running = new Set((queue.queue_running || []).map((i: any) => i[1]));
  if (pending.has(promptId)) { await fetch(`${baseUrl}/queue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) }); return "removed"; }
  if (running.has(promptId)) { await fetch(`${baseUrl}/interrupt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: promptId }) }); return "interrupted"; }
  return "not found";
}

export interface RunArgs {
  baseUrl: string;
  workflow: Json;
  info: WorkflowInfo;
  promptText: string;
  refImagePaths: string[];
  refVideoPaths?: string[];
  refAudioPaths?: string[];
  fieldValues?: Record<string, any>;
  randomizeSeed?: boolean;
  destFolder: string;
  destFilename: string;
  onEvent: EventSink;
  signal?: AbortSignal;
  /** Called as soon as ComfyUI accepts the job (so the caller can cancel it by id). */
  onSubmitted?: (promptId: string) => void;
}

export async function runWorkflow(a: RunArgs): Promise<void> {
  const clientId = crypto.randomUUID();
  const wsUrl = a.baseUrl.replace(/^http/, "ws") + `/ws?clientId=${clientId}`;

  // A blank path is a bypassed slot - nothing to upload.
  const uploadAll = (paths: string[]) => Promise.all(paths.map(p => (p ? uploadFile(a.baseUrl, p) : Promise.resolve(p))));
  const [images, videos, audios] = [await uploadAll(a.refImagePaths), await uploadAll(a.refVideoPaths || []), await uploadAll(a.refAudioPaths || [])];
  let graph = injectWorkflow({ workflow: a.workflow, info: a.info, promptText: a.promptText, refImageFilenames: images, refVideoFilenames: videos, refAudioFilenames: audios, fieldValues: a.fieldValues, randomizeSeed: a.randomizeSeed });
  graph = pruneToOutput(graph, a.info.outputNodeId);

  // Listen BEFORE submitting: a fast (or fully cached) run can finish before a socket opened afterwards sees a message.
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error(`Cannot reach ComfyUI at ${a.baseUrl} - is it running?`)); });

  let promptId = "";
  try {
    promptId = await submitWorkflow(a.baseUrl, graph, clientId);
    a.onSubmitted?.(promptId);
    a.onEvent({ type: "submitted", prompt_id: promptId });
    a.onEvent({ type: "status", message: `submitted as ${promptId}` });

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; resolve(); } };
      const onAbort = () => { a.onEvent({ type: "cancelled" }); finish(); };
      a.signal?.addEventListener("abort", onAbort, { once: true });
      ws.onclose = () => { if (!finished) { a.onEvent({ type: "failed", message: "Lost the connection to ComfyUI while the job was running." }); finish(); } };

      ws.onmessage = async (ev: MessageEvent) => {
        if (finished) return;
        if (typeof ev.data !== "string") {
          // ComfyUI preview frames: 4-byte type + 4-byte format header, then the image bytes
          const buf = Buffer.from(ev.data as ArrayBuffer);
          if (buf.length > 8) a.onEvent({ type: "preview", image_b64: buf.subarray(8).toString("base64") });
          return;
        }
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const data = msg.data || {};
        switch (msg.type) {
          case "status": {
            // Broadcast whenever ComfyUI's queue changes; anything above 1 means other jobs are ahead of ours.
            const remaining = data.status?.exec_info?.queue_remaining;
            if (remaining !== undefined) a.onEvent({ type: "queue", remaining });
            break;
          }
          case "progress": a.onEvent({ type: "progress", value: data.value, max: data.max }); break;
          case "executing":
            if (data.node === null && data.prompt_id === promptId) {
              a.onEvent({ type: "failed", message: "ComfyUI finished without producing the output - if nothing changed since the last run its result was cached; change the prompt or a setting and retry." });
              finish();
            } else if (data.node !== null && data.node !== undefined) a.onEvent({ type: "log", message: `running node ${data.node}` });
            break;
          case "executed":
            if (data.node === a.info.outputNodeId) {
              finished = true;
              try {
                const dest = await saveFirstOutput(a.baseUrl, data.output || {}, a.destFolder, a.destFilename);
                a.onEvent({ type: "done", path: dest });
              } catch (e: any) { a.onEvent({ type: "failed", message: e.message }); }
              resolve();
            }
            break;
          case "execution_interrupted":
            if (!data.prompt_id || data.prompt_id === promptId) { a.onEvent({ type: "cancelled" }); finish(); }
            break;
          case "execution_error": {
            const where = data.node_id ? `node ${data.node_id} (${data.node_type || "?"}): ` : "";
            a.onEvent({ type: "failed", message: where + short(data.exception_message || "unknown ComfyUI error") });
            finish();
            break;
          }
        }
      };
      if (a.signal?.aborted) onAbort();
    });
  } finally {
    try { ws.close(); } catch { /* already closed */ }
  }
}
