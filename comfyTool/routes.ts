/** HTTP API of the workflow runner (everything under /api/tool). See README "Workflow runner". */
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { listWorkflows, loadApiWorkflow, loadWorkflowInfo, loadWorkflowJson, isUiFormat, NO_PROMPT, WorkflowInfo } from "./registry";
import { convertUiWorkflow } from "./convert";
import { extractUpload, PROMPT_FILE_EXTENSIONS } from "./extract";
import { findPrompt } from "./promptFinder";
import { autoOutputName, cancelPrompt, runWorkflow, uniqueDestination, RunEvent } from "./runner";
import { createStore, Kind } from "./store";

type Json = Record<string, any>;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a"]);
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };

export interface ToolOptions {
  /** Where this app's own config files live. */
  dataDir: string;
  getComfyUrl: () => string;
  /** The ComfyUI portable folder, if known (workflows are looked for in ComfyUI/user/default/workflows below it). */
  getComfyRoot: () => string | null;
  /** The app's own result folders (the History gallery shows what lands here). */
  galleryDirs: Record<Kind, string>;
}

interface RunState {
  events: (RunEvent | null)[];
  finished: boolean;
  lastPreview: number | null;
  promptId: string | null;
  abort: AbortController;
  workflow: string;
  kind: Kind;
  prompt: string;
  created: number;
  status: "starting" | "queued" | "running" | "done" | "failed" | "cancelled";
  progress: [number, number] | null;
  result: string | null;
  error: string | null;
  waiters: Set<() => void>;
}

const ACTIVE = ["starting", "queued", "running"];

export function registerComfyTool(app: express.Express, opts: ToolOptions) {
  const store = createStore(opts.dataDir);
  const runs = new Map<string, RunState>();

  // --- ComfyUI's node list: needed to read UI-format workflows and to tell which custom nodes are missing ---
  let objectInfoCache: { at: number; url: string; data: Json } | null = null;
  async function objectInfo(force = false): Promise<Json | null> {
    const url = opts.getComfyUrl();
    if (!force && objectInfoCache && objectInfoCache.url === url && Date.now() - objectInfoCache.at < 60000) return objectInfoCache.data;
    try {
      const r = await fetch(`${url}/object_info`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      objectInfoCache = { at: Date.now(), url, data: (await r.json()) as Json };
      return objectInfoCache.data;
    } catch {
      return objectInfoCache && objectInfoCache.url === url ? objectInfoCache.data : null;
    }
  }
  const comfyReachable = async () => { try { return (await fetch(`${opts.getComfyUrl()}/system_stats`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

  const defaultWorkflowFolder = () => {
    const root = opts.getComfyRoot();
    if (!root) return "";
    return [path.join(root, "ComfyUI", "user", "default", "workflows"), path.join(root, "user", "default", "workflows")].find(p => fs.existsSync(p)) || "";
  };
  const destinationFor = (kind: Kind) => store.loadConfig().destination[kind] || opts.galleryDirs[kind];
  const isKind = (v: any): v is Kind => v === "image" || v === "video";

  const workflowDict = (w: WorkflowInfo) => ({ ...w });

  // --- remembered state ---
  app.get("/api/tool/state", async (req, res) => {
    const kind: Kind = isKind(req.query.kind) ? req.query.kind : "image";
    const c = store.loadConfig();
    res.json({
      workflowFolder: c.workflowFolder || defaultWorkflowFolder(),
      defaultWorkflowFolder: defaultWorkflowFolder(),
      refFolder: c.refFolder,
      promptFileDir: c.promptFileDir,
      destination: c.destination[kind],
      defaultDestination: opts.galleryDirs[kind],
      outputFilename: c.outputFilename[kind],
      lastWorkflow: c.lastWorkflow[kind],
      comfyReachable: await comfyReachable(),
      promptFileTypes: PROMPT_FILE_EXTENSIONS,
    });
  });

  app.post("/api/tool/state", (req, res) => {
    const b = req.body || {};
    const c = store.loadConfig();
    for (const k of ["workflowFolder", "refFolder", "promptFileDir"] as const) if (typeof b[k] === "string") c[k] = b[k];
    if (isKind(b.kind)) {
      if (typeof b.destination === "string") c.destination[b.kind] = b.destination;
      if (typeof b.outputFilename === "string") c.outputFilename[b.kind] = b.outputFilename;
      if (typeof b.lastWorkflow === "string") c.lastWorkflow[b.kind] = b.lastWorkflow;
    }
    store.saveConfig(c);
    res.json({ saved: true });
  });

  // --- workflows ---
  app.get("/api/tool/workflows", async (req, res) => {
    const kind: Kind = isKind(req.query.kind) ? req.query.kind : "image";
    const folder = String(req.query.folder || store.loadConfig().workflowFolder || defaultWorkflowFolder());
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return res.status(400).json({ error: folder ? `Folder not found: ${folder}` : "Choose a workflow folder first." });
    const c = store.loadConfig();
    c.workflowFolder = folder;
    store.saveConfig(c);
    const oi = await objectInfo(true);
    const all = listWorkflows(folder, c.workflowRoles, oi);
    const others: Record<string, number> = { image: 0, video: 0, audio: 0, "3d": 0 };
    for (const w of all) others[w.outputKind]++;
    res.json({ workflows: all.filter(w => w.outputKind === kind).map(workflowDict), counts: others, comfyNodeListAvailable: !!oi, folder });
  });

  app.post("/api/tool/workflow-roles", async (req, res) => {
    const { path: p, promptNodeId, outputNodeId } = req.body || {};
    if (typeof p !== "string" || !fs.existsSync(p)) return res.status(404).json({ error: "workflow not found" });
    const c = store.loadConfig();
    const roles: Json = {};
    if (promptNodeId) roles.prompt_in = promptNodeId;
    if (outputNodeId) roles.output = outputNodeId;
    if (Object.keys(roles).length) c.workflowRoles[p] = roles; else delete c.workflowRoles[p];
    store.saveConfig(c);
    res.json(workflowDict(loadWorkflowInfo(p, roles, await objectInfo())));
  });

  // --- prompt files ---
  app.post("/api/tool/prompt-file", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
    const name = String(req.query.name || "file.txt");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Empty file" });
    try {
      const content = await extractUpload(name, req.body);
      const r = findPrompt(content);
      const raw = content.kind === "text" ? content.text : content.cells.map(c => c.text).join("\n");
      res.json({
        rawText: raw, extractedPrompt: r.prompt, matched: r.matched,
        candidates: r.candidates,
        columns: r.alternatives.map(a => ({ sheet: a.sheet, header: a.header, candidates: a.candidates })),
      });
    } catch (e: any) {
      res.status(422).json({ error: e.message || "Couldn't read that file" });
    }
  });

  // --- reference media library ---
  app.get("/api/tool/ref-media", (req, res) => {
    const folder = String(req.query.folder || "");
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return res.status(400).json({ error: "Folder not found." });
    const c = store.loadConfig();
    c.refFolder = folder;
    store.saveConfig(c);
    const items = fs.readdirSync(folder, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => ({ name: e.name, path: path.join(folder, e.name), ext: path.extname(e.name).toLowerCase() }))
      .filter(f => IMAGE_EXT.has(f.ext) || VIDEO_EXT.has(f.ext) || AUDIO_EXT.has(f.ext))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => ({ name: f.name, path: f.path, type: VIDEO_EXT.has(f.ext) ? "video" : AUDIO_EXT.has(f.ext) ? "audio" : "image" }));
    res.json({ items });
  });

  // Dropped reference file: saved into the reference folder (or outputs/references when none is chosen yet).
  app.post("/api/tool/ref-upload", express.raw({ type: "*/*", limit: "500mb" }), (req, res) => {
    const name = path.basename(String(req.query.name || "")).replace(/[^A-Za-z0-9 ._()-]+/g, "_");
    const ext = path.extname(name).toLowerCase();
    if (!name || !(IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext))) return res.status(400).json({ error: "Not an image, video or audio file" });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Empty file" });
    const c = store.loadConfig();
    const folder = c.refFolder && fs.existsSync(c.refFolder) ? c.refFolder : path.join(opts.dataDir, "outputs", "references");
    fs.mkdirSync(folder, { recursive: true });
    if (c.refFolder !== folder) { c.refFolder = folder; store.saveConfig(c); }
    const dest = uniqueDestination(path.join(folder, name));
    fs.writeFileSync(dest, req.body);
    res.json({ folder, item: { name: path.basename(dest), path: dest, type: VIDEO_EXT.has(ext) ? "video" : AUDIO_EXT.has(ext) ? "audio" : "image" } });
  });

  // Serve a media file for thumbnails / results. Only media inside the folders this tool uses, or a result it made.
  const underDir = (file: string, dir: string) => !!dir && (path.resolve(file) + path.sep).toLowerCase().startsWith((path.resolve(dir) + path.sep).toLowerCase());
  app.get("/api/tool/file", (req, res) => {
    const file = String(req.query.path || "");
    const ext = path.extname(file).toLowerCase();
    const c = store.loadConfig();
    const allowed = MIME[ext] && fs.existsSync(file) && fs.statSync(file).isFile() && (
      store.isKnown(file) || underDir(file, c.refFolder) || underDir(file, c.destination.image) || underDir(file, c.destination.video) ||
      underDir(file, opts.galleryDirs.image) || underDir(file, opts.galleryDirs.video));
    if (!allowed) return res.status(404).end();
    res.type(MIME[ext]);
    res.sendFile(path.resolve(file));
  });

  // --- running ---
  const waitForChange = (state: RunState, ms: number) => new Promise<void>(resolve => { const t = setTimeout(done, ms); function done() { clearTimeout(t); state.waiters.delete(done); resolve(); } state.waiters.add(done); });
  const wake = (state: RunState) => { for (const w of [...state.waiters]) w(); };

  function push(state: RunState, e: RunEvent) {
    if (e.type === "submitted") state.status = "queued";
    else if (e.type === "progress") { state.status = "running"; state.progress = [e.value, e.max]; }
    else if (e.type === "done") { state.status = "done"; state.result = e.path; }
    else if (e.type === "failed") { state.status = "failed"; state.error = e.message; }
    else if (e.type === "cancelled") state.status = "cancelled";
    if (e.type === "preview") { // preview frames are big and only the latest matters - blank the old one
      if (state.lastPreview !== null) state.events[state.lastPreview] = null;
      state.lastPreview = state.events.length;
    }
    state.events.push(e);
    wake(state);
  }

  app.post("/api/tool/run", async (req, res) => {
    const b = req.body || {};
    if (!isKind(b.kind) || typeof b.workflowPath !== "string") return res.status(400).json({ error: "kind and workflowPath are required" });
    const kind: Kind = b.kind;
    const runId = crypto.randomUUID().replace(/-/g, "");
    const state: RunState = {
      events: [], finished: false, lastPreview: null, promptId: null, abort: new AbortController(), kind,
      workflow: path.basename(b.workflowPath, path.extname(b.workflowPath)), prompt: String(b.promptText || "").split(/\s+/).filter(Boolean).join(" "),
      created: Date.now(), status: "starting", progress: null, result: null, error: null, waiters: new Set(),
    };
    runs.set(runId, state);
    res.json({ runId });

    (async () => {
      try {
        const c = store.loadConfig();
        const oi = await objectInfo();
        const roles = c.workflowRoles[b.workflowPath];
        const info = loadWorkflowInfo(b.workflowPath, roles, oi);
        if (!info.isRunnable) throw new Error("workflow cannot run: " + info.missing.join("; "));
        const { graph } = loadApiWorkflow(b.workflowPath, oi);
        const destFolder = (typeof b.outputFolder === "string" && b.outputFolder.trim()) || destinationFor(kind);
        const refPaths = [...(b.refImagePaths || []), ...(b.refVideoPaths || []), ...(b.refAudioPaths || [])];
        const destFilename = (typeof b.outputFilename === "string" && b.outputFilename.trim()) || autoOutputName(refPaths, state.workflow);
        await runWorkflow({
          baseUrl: opts.getComfyUrl(), workflow: graph, info, promptText: String(b.promptText || ""),
          refImagePaths: b.refImagePaths || [], refVideoPaths: b.refVideoPaths || [], refAudioPaths: b.refAudioPaths || [],
          fieldValues: b.fieldValues || {}, randomizeSeed: b.randomizeSeed !== false,
          destFolder, destFilename, signal: state.abort.signal,
          onSubmitted: id => { state.promptId = id; },
          onEvent: e => {
            if (e.type === "done") store.addHistory(e.path, state.workflow, String(b.promptText || ""), kind);
            push(state, e);
          },
        });
      } catch (e: any) {
        push(state, { type: "failed", message: e?.message || String(e) });
      } finally {
        state.finished = true;
        wake(state);
      }
    })();
  });

  app.post("/api/tool/cancel/:id", async (req, res) => {
    const state = runs.get(req.params.id);
    if (!state) return res.status(404).json({ error: "unknown run" });
    if (state.finished) return res.json({ cancelled: false });
    if (state.promptId) { try { await cancelPrompt(opts.getComfyUrl(), state.promptId); } catch { /* ComfyUI unreachable - still stop waiting on it */ } }
    state.abort.abort();
    res.json({ cancelled: true });
  });

  // Server-sent events. Reads by position (not by consuming), so a browser that drops and reconnects mid-run picks up where it left off.
  app.get("/api/tool/progress/:id", async (req, res) => {
    const state = runs.get(req.params.id);
    if (!state) return res.status(404).json({ error: "unknown run - the app was restarted since it started" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    let closed = false;
    res.on("close", () => { closed = true; wake(state); });
    const last = req.headers["last-event-id"];
    let index = typeof last === "string" && /^\d+$/.test(last) ? Number(last) : 0;
    while (!closed) {
      while (index < state.events.length) {
        const e = state.events[index++];
        if (e) res.write(`id: ${index}\ndata: ${JSON.stringify(e)}\n\n`);
      }
      if (state.finished && index >= state.events.length) break;
      await waitForChange(state, 10000);
      if (!closed && index >= state.events.length && !state.finished) res.write(": keepalive\n\n");
    }
    res.end();
  });

  // The jobs this app started (waiting, running, recent) with their place in ComfyUI's own queue.
  app.get("/api/tool/runs", async (req, res) => {
    const kind = isKind(req.query.kind) ? req.query.kind : null;
    let runningIds = new Set<string>(), pendingIds: string[] = [], reachable = true;
    try {
      const q: any = await (await fetch(`${opts.getComfyUrl()}/queue`, { signal: AbortSignal.timeout(3000) })).json();
      runningIds = new Set((q.queue_running || []).map((i: any) => i[1]));
      pendingIds = (q.queue_pending || []).map((i: any) => i[1]);
    } catch { reachable = false; }
    const rows = [...runs.entries()].filter(([, s]) => !kind || s.kind === kind).map(([runId, s]) => {
      let status: string = s.status, ahead: number | null = null;
      if ((status === "queued" || status === "running") && reachable && s.promptId) {
        if (runningIds.has(s.promptId)) status = "running";
        else if (pendingIds.includes(s.promptId)) { status = "queued"; ahead = pendingIds.indexOf(s.promptId) + runningIds.size; }
      }
      return { runId, kind: s.kind, workflow: s.workflow, prompt: s.prompt.slice(0, 140), status, ahead, created: s.created, progress: s.progress && status === "running" ? s.progress : null, result: s.result, error: s.error, cancellable: ACTIVE.includes(status) };
    }).sort((a, b) => b.created - a.created);
    res.json({ comfyReachable: reachable, active: rows.filter(r => ACTIVE.includes(r.status)), finished: rows.filter(r => !ACTIVE.includes(r.status)).slice(0, 8) });
  });

  // --- results ---
  app.get("/api/tool/history", (req, res) => res.json({ history: store.history(isKind(req.query.kind) ? req.query.kind : undefined) }));

  app.post("/api/tool/delete-output", (req, res) => {
    const p = String(req.body?.path || "");
    // Only a file this tool itself generated can be deleted through the API.
    if (!store.isKnown(p)) return res.status(403).json({ error: "only results generated by this app can be deleted" });
    try { fs.unlinkSync(p); } catch { /* already gone */ }
    store.removeHistory(p);
    res.json({ deleted: true });
  });

  // Open the file manager with a result selected (only results this tool made).
  app.post("/api/tool/reveal", (req, res) => {
    const p = String(req.body?.path || "");
    if (!store.isKnown(p) || !fs.existsSync(p)) return res.status(404).json({ error: "File not found" });
    try {
      if (process.platform === "win32") spawn("explorer.exe", [`/select,${path.resolve(p)}`], { detached: true, stdio: "ignore" }).unref();
      else if (process.platform === "darwin") spawn("open", ["-R", p], { detached: true, stdio: "ignore" }).unref();
      else spawn("xdg-open", [path.dirname(p)], { detached: true, stdio: "ignore" }).unref();
      res.json({ status: "success" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // --- batch-convert a folder of UI-format workflows to API format files ---
  app.post("/api/tool/convert-folder", async (req, res) => {
    const { source, dest } = req.body || {};
    const oi = await objectInfo(true);
    if (!oi) return res.status(503).json({ error: `ComfyUI is not reachable at ${opts.getComfyUrl()} - it must be running to convert (it supplies the node list)` });
    if (typeof source !== "string" || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) return res.status(400).json({ error: `source folder not found: ${source}` });
    if (typeof dest !== "string" || !dest.trim()) return res.status(400).json({ error: "choose a destination folder" });
    if (path.resolve(source).toLowerCase() === path.resolve(dest).toLowerCase()) return res.status(400).json({ error: "destination must be a different folder than the source (originals are never overwritten)" });
    fs.mkdirSync(dest, { recursive: true });
    const results: { name: string; status: string; detail: string }[] = [];
    for (const name of fs.readdirSync(source).filter(n => n.toLowerCase().endsWith(".json") && !n.startsWith(".")).sort()) {
      let data: any;
      try { data = loadWorkflowJson(path.join(source, name)); } catch (e: any) { results.push({ name, status: "invalid", detail: `not valid JSON: ${e.message}` }); continue; }
      if (!isUiFormat(data)) { results.push({ name, status: "already_api", detail: "already API format - skipped" }); continue; }
      const r = convertUiWorkflow(data, oi);
      if (!r.ok) {
        const parts: string[] = [];
        if (r.unknownTypes.length) parts.push("custom node(s) not installed in ComfyUI: " + [...new Set(r.unknownTypes.map(t => t[1]))].sort().join(", "));
        const dropped = new Set(r.unknownTypes.map(t => t[0]));
        const other = r.danglingLinks.filter(d => !dropped.has(d[2]));
        if (other.length) parts.push(`node ${other[0][0]}.${other[0][1]} points at missing node ${other[0][2]}${other.length > 1 ? ` (+${other.length - 1} more)` : ""}`);
        results.push({ name, status: "issues", detail: parts.join("; ") });
        continue;
      }
      fs.writeFileSync(path.join(dest, name), JSON.stringify(r.apiWorkflow, null, 2));
      results.push({ name, status: "converted", detail: `${Object.keys(r.apiWorkflow).length} nodes` });
    }
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
    res.json({ results, counts, dest });
  });
}
