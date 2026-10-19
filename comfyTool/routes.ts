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
import { createPromptDb } from "./promptDb";
import { createRecentDocs } from "./recentDocs";
import { createGoogle, fetchPublicGoogleFile, parseGoogleLink } from "./google";

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
  status: "starting" | "queued" | "running" | "done" | "failed" | "cancelled" | "paused";
  /** The request this run was started from, kept so a paused job can be resumed. */
  body: Json;
  paused: boolean;
  progress: [number, number] | null;
  result: string | null;
  error: string | null;
  waiters: Set<() => void>;
}

const ACTIVE = ["starting", "queued", "running"];
const LISTED = [...ACTIVE, "paused"];

export function registerComfyTool(app: express.Express, opts: ToolOptions) {
  const store = createStore(opts.dataDir);
  const promptDb = createPromptDb(opts.dataDir);
  const recentDocs = createRecentDocs(opts.dataDir);
  const google = createGoogle(opts.dataDir, () => `http://127.0.0.1:${Number(process.env.PORT) || 3000}`);
  // Auto-save to Google Drive: runs in the background after a result is recorded; the link is kept with the prompt.
  const driveAutosave = (file: string) => {
    if (!file || !google.wantsAutosave()) return;
    google.upload(file).then(r => { if (r.ok && r.url) promptDb.setDriveUrl(file, r.url); }).catch(() => {});
  };
  // First run: bring over the workflow results already recorded in comfy-tool-history.json.
  if (promptDb.count() === 0) {
    try { for (const h of store.history().slice().reverse()) if (h.prompt) promptDb.add({ kind: h.kind, mode: "workflow", workflow: h.workflow, prompt: h.prompt, file: h.path, createdAt: Date.parse(h.createdAt) || Date.now() }); } catch { /* nothing to import */ }
  }
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
  // Bytes of a document / sheet / slide deck -> the prompt(s) found in it.
  const promptResult = async (name: string, bytes: Buffer, source: "file" | "drive" | "link" = "file") => {
    const content = await extractUpload(name, bytes);
    const r = findPrompt(content);
    const raw = content.kind === "text" ? content.text : content.cells.map(c => c.text).join("\n");
    const out = { rawText: raw, extractedPrompt: r.prompt, matched: r.matched, candidates: r.candidates, columns: r.alternatives.map(a => ({ sheet: a.sheet, header: a.header, candidates: a.candidates })) };
    try { recentDocs.add(name, source, out); } catch { /* remembering must never block reading */ }
    return out;
  };
  app.get("/api/tool/recent-docs", (_req, res) => res.json({ docs: recentDocs.list() }));
  app.get("/api/tool/recent-docs/latest", (_req, res) => { const d = recentDocs.latest(); res.json(d ? { id: d.id, name: d.name, source: d.source, result: d.result } : null); });
  app.get("/api/tool/recent-docs/:id", (req, res) => { const d = recentDocs.get(req.params.id); if (!d) return res.status(404).json({ error: "That document is no longer in the recent list." }); res.json({ id: d.id, name: d.name, source: d.source, result: d.result }); });
  app.delete("/api/tool/recent-docs/:id", (req, res) => { recentDocs.remove(req.params.id); res.json({ removed: true }); });

  // --- Google Drive / Sheets / Docs ---
  const gErr = (res: express.Response, e: any, code = 400) => res.status(code).json({ error: e?.message || String(e) });
  app.get("/api/google/status", (_req, res) => res.json(google.status()));
  app.post("/api/google/client", (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    if (typeof clientId !== "string" || typeof clientSecret !== "string" || !clientId.trim() || !clientSecret.trim()) return gErr(res, "Both the client ID and the client secret are needed.");
    try { google.setClient(clientId, clientSecret); } catch (e) { return gErr(res, e); }
    res.json(google.status());
  });
  app.get("/api/google/connect", (_req, res) => { try { res.json({ url: google.authUrl() }); } catch (e) { gErr(res, e); } });
  app.get("/api/google/callback", async (req, res) => {
    const page = (title: string, body: string) => res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Cursed_Ai</title><body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px"><h2>${title}</h2><p style="color:#a1a1aa">${body}</p></div></body>`);
    if (req.query.error) return page("Google sign-in was cancelled", "You can close this window and try again from Cursed_Ai.");
    try { await google.handleCallback(String(req.query.code || ""), String(req.query.state || "")); page("Connected to Google", "You can close this window and go back to Cursed_Ai."); }
    catch (e: any) { page("Could not connect", String(e?.message || e).split("<").join("&lt;")); }
  });
  app.post("/api/google/disconnect", (_req, res) => { google.disconnect(); res.json(google.status()); });
  app.post("/api/google/settings", (req, res) => { google.settings({ autosave: typeof req.body?.autosave === "boolean" ? req.body.autosave : undefined, folder: req.body?.folder }); res.json(google.status()); });
  app.get("/api/google/files", async (req, res) => {
    try { res.json(await google.list({ parent: String(req.query.parent || "root"), q: String(req.query.q || ""), pageToken: req.query.pageToken ? String(req.query.pageToken) : undefined, foldersOnly: req.query.foldersOnly === "1" })); } catch (e) { gErr(res, e); }
  });
  app.post("/api/google/folder", async (req, res) => {
    try { res.json(await google.createFolder(String(req.body?.name || "").trim() || "Cursed_Ai", req.body?.parent ? String(req.body.parent) : undefined)); } catch (e) { gErr(res, e); }
  });
  app.post("/api/google/prompt-file", async (req, res) => {
    const { id, name, mimeType } = req.body || {};
    if (typeof id !== "string" || !id) return gErr(res, "Choose a file first.");
    try { const f = await google.download(id, String(name || "file"), String(mimeType || "")); res.json({ ...(await promptResult(f.name, f.bytes, "drive")), source: f.name }); } catch (e) { gErr(res, e, 422); }
  });
  app.post("/api/google/link", async (req, res) => {
    const link = parseGoogleLink(String(req.body?.url || ""));
    if (!link) return gErr(res, "That is not a Google Sheets, Docs, Slides or Drive link.");
    try {
      let f: { name: string; bytes: Buffer };
      if (google.connected()) {
        try { const m = await google.meta(link.id); f = await google.download(link.id, m.name, m.mimeType); }
        catch { f = await fetchPublicGoogleFile(link.id, link.kind); }
      } else f = await fetchPublicGoogleFile(link.id, link.kind);
      res.json({ ...(await promptResult(f.name, f.bytes, "link")), source: f.name });
    } catch (e) { gErr(res, e, 422); }
  });

  app.post("/api/tool/prompt-file", express.raw({ type: "*/*", limit: "1gb" }), async (req, res) => {
    const name = String(req.query.name || "file.txt");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Empty file" });
    try {
      res.json(await promptResult(name, req.body));
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

  // Windows' own file / folder dialogs (the app and the browser run on the same PC). Picked locations become readable for thumbnails.
  const pickedDirs = new Set<string>();
  app.post("/api/tool/native-pick", (req, res) => {
    if (process.platform !== "win32") return res.status(501).json({ error: "native dialog only on Windows" });
    const mode = req.body?.mode === "folder" ? "folder" : "files";
    const initial = typeof req.body?.initial === "string" && fs.existsSync(req.body.initial) ? req.body.initial : "";
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "[System.Windows.Forms.Application]::EnableVisualStyles()",
      "$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true; $o.ShowInTaskbar = $false; $o.StartPosition = 'CenterScreen'; $o.Size = New-Object System.Drawing.Size(0,0); $o.Show()",
      mode === "folder"
        ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.ShowNewFolderButton = $true; if ($env:PICK_INITIAL) { $d.SelectedPath = $env:PICK_INITIAL }; if ($d.ShowDialog($o) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }"
        : "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; $d.Filter = 'Images, video and audio|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.mp4;*.webm;*.mov;*.mkv;*.mp3;*.wav;*.flac;*.ogg;*.m4a|All files|*.*'; if ($env:PICK_INITIAL) { $d.InitialDirectory = $env:PICK_INITIAL }; if ($d.ShowDialog($o) -eq 'OK') { [Console]::Out.Write(($d.FileNames -join [char]10)) }",
      "$o.Close()",
    ].join("; ");
    const ps = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { env: { ...process.env, PICK_INITIAL: initial }, windowsHide: false });
    let out = "";
    ps.stdout.on("data", d => { out += d.toString("utf8"); });
    ps.on("error", e => res.status(500).json({ error: e.message }));
    ps.on("close", () => {
      const paths = out.split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean);
      for (const p of paths) pickedDirs.add(mode === "folder" ? p : path.dirname(p));
      if (mode === "folder") return res.json({ path: paths[0] || null });
      res.json({
        paths,
        items: paths.map(p => { const ext = path.extname(p).toLowerCase(); return { name: path.basename(p), path: p, type: VIDEO_EXT.has(ext) ? "video" : AUDIO_EXT.has(ext) ? "audio" : "image" }; }),
      });
    });
  });

  // Serve a media file for thumbnails / results. Only media inside the folders this tool uses, or a result it made.
  const underDir = (file: string, dir: string) => !!dir && (path.resolve(file) + path.sep).toLowerCase().startsWith((path.resolve(dir) + path.sep).toLowerCase());
  app.get("/api/tool/file", (req, res) => {
    const file = String(req.query.path || "");
    const ext = path.extname(file).toLowerCase();
    const c = store.loadConfig();
    const allowed = MIME[ext] && fs.existsSync(file) && fs.statSync(file).isFile() && (
      store.isKnown(file) || underDir(file, c.refFolder) || underDir(file, c.destination.image) || underDir(file, c.destination.video) ||
      underDir(file, opts.galleryDirs.image) || underDir(file, opts.galleryDirs.video) || [...pickedDirs].some(d => underDir(file, d)));
    if (!allowed) return res.status(404).end();
    res.type(MIME[ext]);
    res.sendFile(path.resolve(file));
  });

  // --- running ---
  const waitForChange = (state: RunState, ms: number) => new Promise<void>(resolve => { const t = setTimeout(done, ms); function done() { clearTimeout(t); state.waiters.delete(done); resolve(); } state.waiters.add(done); });
  const wake = (state: RunState) => { for (const w of [...state.waiters]) w(); };

  function push(state: RunState, e: RunEvent) {
    if (e.type === "cancelled" && state.paused) { state.status = "paused"; state.events.push(e); wake(state); return; }
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

  // Size / length / fps the run used, for the prompt library cards.
  const summarise = (info: WorkflowInfo, fieldValues: Json = {}): Json => {
    const get = (role: string) => { const f = info.fields.find(x => x.role === role); return f ? (f.id in fieldValues ? fieldValues[f.id] : f.value) : undefined; };
    const out: Json = {};
    const w = get("width"), h = get("height"), len = get("length"), fps = get("fps");
    if (w && h) out.size = `${w}×${h}`;
    if (len) out.frames = len;
    if (fps) out.fps = fps;
    if (len && fps) out.seconds = Math.round((Number(len) / Number(fps)) * 10) / 10;
    return out;
  };

  function startRun(b: Json): string {
    const kind: Kind = b.kind;
    const runId = crypto.randomUUID().replace(/-/g, "");
    const state: RunState = {
      events: [], finished: false, lastPreview: null, promptId: null, abort: new AbortController(), kind,
      workflow: path.basename(b.workflowPath, path.extname(b.workflowPath)), prompt: String(b.promptText || "").split(/\s+/).filter(Boolean).join(" "),
      created: Date.now(), status: "starting", progress: null, result: null, error: null, waiters: new Set(), body: b, paused: false,
    };
    runs.set(runId, state);

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
            if (e.type === "done") {
              store.addHistory(e.path, state.workflow, String(b.promptText || ""), kind);
              try { promptDb.add({ kind, mode: "workflow", workflow: state.workflow, prompt: String(b.promptText || ""), params: { ...summarise(info, b.fieldValues), fieldValues: b.fieldValues || {} }, file: e.path }); driveAutosave(e.path); } catch { /* the library must never break a run */ }
            }
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
    return runId;
  }

  app.post("/api/tool/run", (req, res) => {
    const b = req.body || {};
    if (!isKind(b.kind) || typeof b.workflowPath !== "string") return res.status(400).json({ error: "kind and workflowPath are required" });
    res.json({ runId: startRun(b) });
  });

  // Pause = take a job that is still waiting out of ComfyUI's queue and keep it here; resume puts it back at the end.
  // (ComfyUI cannot pause a job that is already generating - only cancel it.)
  app.post("/api/tool/pause/:id", async (req, res) => {
    const state = runs.get(req.params.id);
    if (!state) return res.status(404).json({ error: "unknown run" });
    if (state.finished || state.status === "running") return res.status(409).json({ error: "A job that is already generating cannot be paused - cancel it instead." });
    state.paused = true;
    if (state.promptId) { try { await cancelPrompt(opts.getComfyUrl(), state.promptId); } catch { /* ComfyUI unreachable */ } }
    state.abort.abort();
    res.json({ paused: true });
  });

  app.post("/api/tool/resume/:id", (req, res) => {
    const state = runs.get(req.params.id);
    if (!state || state.status !== "paused") return res.status(404).json({ error: "no paused job with that id" });
    runs.delete(req.params.id);
    res.json({ runId: startRun(state.body) });
  });

  // Drop a paused job for good.
  app.delete("/api/tool/runs/:id", (req, res) => {
    const state = runs.get(req.params.id);
    if (state && state.status === "paused") runs.delete(req.params.id);
    res.json({ removed: true });
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
      return { runId, kind: s.kind, workflow: s.workflow, prompt: s.prompt.slice(0, 140), status, ahead, created: s.created, progress: s.progress && status === "running" ? s.progress : null, result: s.result, error: s.error, cancellable: ACTIVE.includes(status), pausable: status === "queued" || status === "starting" };
    }).sort((a, b) => b.created - a.created);
    res.json({ comfyReachable: reachable, active: rows.filter(r => LISTED.includes(r.status)), finished: rows.filter(r => !LISTED.includes(r.status)).slice(0, 8) });
  });

  // --- prompt library ---
  const mediaUrl = (e: { file: string; kind: Kind }) => {
    if (!e.file) return "";
    const g = opts.galleryDirs[e.kind];
    return underDir(e.file, g) ? `/api/gallery/file/${e.kind}/${encodeURIComponent(path.basename(e.file))}` : `/api/tool/file?path=${encodeURIComponent(e.file)}`;
  };
  const decorate = (e: ReturnType<typeof promptDb.get> & object) => ({ ...e, url: mediaUrl(e), exists: !!e.file && fs.existsSync(e.file) });
  app.get("/api/prompts", (req, res) => {
    const q = req.query;
    res.json((() => {
      const r = promptDb.list({
        kind: isKind(q.kind) ? q.kind : undefined, q: String(q.q || ""), favorite: q.favorite === "1", mode: q.mode ? String(q.mode) : undefined,
        sort: ["new", "old", "az", "fav"].includes(String(q.sort)) ? (String(q.sort) as any) : "new", limit: Number(q.limit) || 60, offset: Number(q.offset) || 0,
      });
      return { total: r.total, items: r.items.map(decorate) };
    })());
  });
  app.post("/api/prompts", (req, res) => {
    const b = req.body || {};
    if (!isKind(b.kind) || typeof b.prompt !== "string" || !b.prompt.trim()) return res.status(400).json({ error: "kind and prompt are required" });
    // The browser names a gallery file; the full path is built here.
    const file = typeof b.galleryFile === "string" && b.galleryFile ? path.join(opts.galleryDirs[b.kind as Kind], path.basename(b.galleryFile)) : typeof b.file === "string" ? b.file : "";
    const id = promptDb.add({ kind: b.kind, mode: String(b.mode || ""), workflow: String(b.workflow || ""), prompt: b.prompt, negative: String(b.negative || ""), params: typeof b.params === "object" && b.params ? b.params : {}, file });
    if (id) driveAutosave(file);
    res.json({ id });
  });
  app.patch("/api/prompts/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!promptDb.update(id, req.body || {})) return res.status(404).json({ error: "Entry not found or nothing to change" });
    res.json(decorate(promptDb.get(id)!));
  });
  app.delete("/api/prompts/:id", (req, res) => { promptDb.remove(Number(req.params.id)); res.json({ removed: true }); });

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
