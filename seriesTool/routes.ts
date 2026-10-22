/**
 * HTTP surface for Series Studio.
 *
 * Generation reuses the existing workflow runner (comfyTool/runner.ts) rather than talking to
 * ComfyUI directly, so reference uploads, websocket progress, cancel and the save-to-folder step
 * behave exactly as they do on the Image and Video tabs.
 *
 * Jobs for one project run one at a time: ComfyUI renders serially anyway, and a single queue
 * keeps the UI's idea of "what is running" honest.
 */
import express from "express";
import fs from "fs";
import path from "path";
import { loadApiWorkflow, loadWorkflowInfo, type WorkflowInfo } from "../comfyTool/registry";
import { runWorkflow, cancelPrompt, uniqueDestination, type RunEvent } from "../comfyTool/runner";
import { probeDuration, stitch } from "./ffmpeg";
import { extractUpload } from "../comfyTool/extract";
import { refSourceFiles } from "./refSources";
import { refKindInfo } from "./refKinds";
import { buildScenePrompt, newId, snapFrames, type Episode, type Project, type Ref, type Scene, type Source, type Status } from "./model";
import { createSeriesStore } from "./store";

type Json = Record<string, any>;

export interface SeriesOptions {
  /** Where project folders live. */
  projectsRoot: string;
  getComfyUrl: () => string;
}

interface Job {
  projectId: string;
  /** Scene or ref id - what the UI highlights as running. */
  targetId: string;
  kind: "ref" | "scene";
  label: string;
  abort: AbortController;
  promptId: string | null;
  progress: [number, number] | null;
}

export function registerSeriesTool(app: express.Express, opts: SeriesOptions) {
  const store = createSeriesStore(opts.projectsRoot);

  /** One sequential queue per project, plus the SSE listeners watching it. */
  const queues = new Map<string, Promise<void>>();
  const running = new Map<string, Job>();
  const listeners = new Map<string, Set<express.Response>>();

  const emit = (projectId: string, event: Json) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of listeners.get(projectId) || []) res.write(payload);
  };

  const bad = (res: express.Response, code: number, message: string) => res.status(code).json({ error: message });

  const findScene = (p: Project, sceneId: string) => {
    for (const ep of p.episodes) {
      const scene = ep.scenes.find(s => s.id === sceneId);
      if (scene) return { ep, scene };
    }
    return null;
  };

  const findRef = (p: Project, refId: string) => {
    for (const ep of p.episodes) {
      const ref = ep.refs.find(r => r.id === refId);
      if (ref) return { ep, ref };
    }
    return null;
  };

  /** Write a status change straight to project.json so a refresh (or a crash) shows the truth. */
  function mark(projectId: string, targetId: string, kind: "ref" | "scene", changes: Partial<Scene> & Partial<Ref>) {
    const p = store.get(projectId);
    if (!p) return;
    const found = kind === "scene" ? findScene(p, targetId) : findRef(p, targetId);
    if (!found) return;
    Object.assign(kind === "scene" ? (found as any).scene : (found as any).ref, changes);
    store.save(p);
    emit(projectId, { type: "updated", targetId, kind, changes });
  }

  let objectInfoCache: { at: number; url: string; data: Json } | null = null;
  async function objectInfo(): Promise<Json | null> {
    const url = opts.getComfyUrl();
    if (objectInfoCache && objectInfoCache.url === url && Date.now() - objectInfoCache.at < 60_000) return objectInfoCache.data;
    try {
      const r = await fetch(`${url}/object_info`, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(String(r.status));
      objectInfoCache = { at: Date.now(), url, data: (await r.json()) as Json };
      return objectInfoCache.data;
    } catch {
      return objectInfoCache?.url === url ? objectInfoCache.data : null;
    }
  }

  /**
   * Map the project's size / duration / steps onto whichever inputs this particular workflow
   * exposes. Workflows name these differently, so match on the role the registry worked out
   * rather than on node ids that only exist in one graph.
   */
  function fieldValuesFor(info: WorkflowInfo, p: Project, kind: "ref" | "scene"): Record<string, any> {
    const values: Record<string, any> = {};
    for (const field of info.fields) {
      if (field.role === "width") values[field.id] = p.settings.width;
      else if (field.role === "height") values[field.id] = p.settings.height;
      else if (field.role === "length" && kind === "scene") values[field.id] = snapFrames(p.settings.seconds, p.settings.fps);
      else if (field.role === "fps" && kind === "scene") values[field.id] = p.settings.fps;
      // The steps setting is for the video model; a still keeps the step count its own workflow was built for.
      else if (field.input === "steps" && kind === "scene") values[field.id] = p.settings.steps;
    }
    return values;
  }

  async function prepare(p: Project, kind: "ref" | "scene") {
    const file = kind === "scene" ? p.settings.videoWorkflow : p.settings.imageWorkflow;
    if (!file) throw new Error(`No ${kind === "scene" ? "video" : "image"} workflow chosen in project settings.`);
    if (!fs.existsSync(file)) throw new Error(`Workflow not found: ${file}`);
    const oi = await objectInfo();
    const info = loadWorkflowInfo(file, {}, oi);
    if (!info.isRunnable) throw new Error(`That workflow cannot run: ${info.missing.join(", ") || "unknown reason"}`);
    const { graph } = loadApiWorkflow(file, oi);
    return { info, graph };
  }

  /** Queue one job behind whatever this project is already doing. */
  function enqueue(projectId: string, job: Omit<Job, "abort" | "promptId" | "progress">, work: (job: Job) => Promise<void>) {
    const full: Job = { ...job, abort: new AbortController(), promptId: null, progress: null };
    const prev = queues.get(projectId) || Promise.resolve();
    const next = prev.then(async () => {
      if (full.abort.signal.aborted) return;
      running.set(projectId, full);
      emit(projectId, { type: "started", targetId: full.targetId, kind: full.kind, label: full.label });
      try {
        await work(full);
      } catch (e: any) {
        const message = full.abort.signal.aborted ? "Cancelled." : (e?.message || String(e));
        mark(projectId, full.targetId, full.kind, { status: full.abort.signal.aborted ? "pending" : "failed", error: message });
        emit(projectId, { type: "failed", targetId: full.targetId, error: message });
      } finally {
        if (running.get(projectId) === full) running.delete(projectId);
      }
    });
    queues.set(projectId, next);
    mark(projectId, full.targetId, full.kind, { status: "queued", error: null });
    return full;
  }

  function runEventSink(projectId: string, job: Job): (e: RunEvent) => void {
    return event => {
      if (event.type === "progress" && typeof event.value === "number") {
        job.progress = [event.value, event.max ?? 0];
        emit(projectId, { type: "progress", targetId: job.targetId, value: event.value, max: event.max });
      } else if (event.type === "status" || event.type === "executing") {
        emit(projectId, { type: "note", targetId: job.targetId, text: event.text || event.type });
      }
    };
  }

  // ---------------------------------------------------------------- projects

  app.get("/api/series/projects", (_req, res) => {
    res.json({
      projects: store.list().map(p => ({
        id: p.id, title: p.title, dir: p.dir, updatedAt: p.updatedAt,
        episodes: p.episodes.length,
        scenes: p.episodes.reduce((n, e) => n + e.scenes.length, 0),
        scenesDone: p.episodes.reduce((n, e) => n + e.scenes.filter(s => s.status === "done").length, 0),
        exports: p.episodes.filter(e => e.exportPath).length,
      })),
      root: store.root,
    });
  });

  app.post("/api/series/projects", (req, res) => {
    const title = String(req.body?.title || "").trim();
    if (!title) return bad(res, 400, "Give the project a title.");
    res.json(store.create(title));
  });

  app.get("/api/series/projects/:id", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    res.json({ ...p, running: running.get(p.id) ? { targetId: running.get(p.id)!.targetId, label: running.get(p.id)!.label, progress: running.get(p.id)!.progress } : null });
  });

  app.patch("/api/series/projects/:id", (req, res) => {
    const p = store.patch(req.params.id, req.body || {});
    if (!p) return bad(res, 404, "No such project.");
    res.json(p);
  });

  app.delete("/api/series/projects/:id", (req, res) => {
    if (!store.remove(req.params.id)) return bad(res, 404, "No such project.");
    res.json({ ok: true });
  });

  /** Live job events for one project. */
  app.get("/api/series/projects/:id/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": open\n\n");
    const id = req.params.id;
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id)!.add(res);
    const beat = setInterval(() => res.write(": beat\n\n"), 25_000);
    req.on("close", () => { clearInterval(beat); listeners.get(id)?.delete(res); });
  });

  // ------------------------------------------------------------------ assets

  /** Serve a still or clip that lives inside the project folder. */
  app.get("/api/series/file", (req, res) => {
    const file = String(req.query.path || "");
    const owner = store.list().find(p => path.resolve(file).startsWith(path.resolve(p.dir)));
    if (!owner || !fs.existsSync(file)) return bad(res, 404, "File not found.");
    res.sendFile(path.resolve(file));
  });

  const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

  /**
   * Attach a story written outside the app - txt, markdown, Word, PDF, Excel, or a photo of a
   * page. Everything is reduced to plain text here (images go through OCR) so the planner only
   * ever deals with text.
   */
  app.post("/api/series/projects/:id/sources", express.raw({ type: "*/*", limit: "200mb" }), async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const name = path.basename(String(req.query.name || "story.txt"));
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "That file was empty.");
    try {
      const content = await extractUpload(name, req.body);
      const text = content.kind === "text"
        ? content.text
        : content.cells.map(c => String(c ?? "")).filter(Boolean).join("\n");
      if (!text.trim()) return bad(res, 422, "No text could be read out of that file.");
      const source: Source = { id: newId(), name, text: text.trim(), addedAt: new Date().toISOString() };
      p.sources = [...(p.sources || []), source];
      store.save(p);
      res.json({ source: { ...source, text: source.text.slice(0, 400) }, chars: text.length });
    } catch (e: any) {
      bad(res, 422, e?.message || "Could not read that file.");
    }
  });

  /** Paste story text straight in, for when there is no file to upload. */
  app.post("/api/series/projects/:id/sources/text", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const text = String(req.body?.text || "").trim();
    if (!text) return bad(res, 400, "Nothing to add.");
    const source: Source = { id: newId(), name: String(req.body?.name || "Pasted story"), text, addedAt: new Date().toISOString() };
    p.sources = [...(p.sources || []), source];
    store.save(p);
    res.json({ source: { ...source, text: source.text.slice(0, 400) }, chars: text.length });
  });

  /** Store the digest the UI produced for a long document. */
  app.patch("/api/series/projects/:id/sources/:sourceId", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const source = (p.sources || []).find(s => s.id === req.params.sourceId);
    if (!source) return bad(res, 404, "No such source.");
    const digest = String(req.body?.digest || "").trim();
    if (!digest) return bad(res, 400, "Empty digest.");
    source.digest = digest;
    source.digestedAt = new Date().toISOString();
    store.save(p);
    res.json({ ok: true, chars: digest.length });
  });

  app.delete("/api/series/projects/:id/sources/:sourceId", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    p.sources = (p.sources || []).filter(s => s.id !== req.params.sourceId);
    store.save(p);
    res.json({ ok: true });
  });


  /**
   * Drop an image into a project as a reference: a character's face, a costume, a location.
   * Uploaded art is used as-is rather than generated, so the ref is marked done immediately.
   */
  app.post("/api/series/projects/:id/episodes/:episodeId/upload", express.raw({ type: "*/*", limit: "100mb" }), (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const ep = p.episodes.find(e => e.id === req.params.episodeId);
    if (!ep) return bad(res, 404, "No such episode.");

    const original = path.basename(String(req.query.name || "")).replace(/[^A-Za-z0-9 ._()-]+/g, "_");
    const ext = path.extname(original).toLowerCase();
    if (!original || !IMAGE_EXT.has(ext)) return bad(res, 400, "Attach a PNG, JPG or WebP image.");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "That file was empty.");

    const dest = uniqueDestination(path.join(store.refsDir(p), original));
    fs.writeFileSync(dest, req.body);

    const ref: Ref = {
      id: newId(),
      name: String(req.query.label || path.basename(original, ext)).slice(0, 60),
      role: req.query.role === "style" || req.query.kind === "style" || req.query.kind === "palette" ? "style" : "character",
      kind: refKindInfo(String(req.query.kind || ""))?.id,
      prompt: "",
      negative: "",
      seed: Math.floor(Math.random() * 100000),
      file: dest,
      status: "done",
      error: null,
    };
    ep.refs.push(ref);
    store.save(p);
    emit(p.id, { type: "updated", targetId: ref.id, kind: "ref", changes: { status: "done" } });
    res.json({ ref });
  });

  /** Drop a reference (and its file, if it lives in this project). */
  app.delete("/api/series/projects/:id/refs/:refId", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findRef(p, req.params.refId);
    if (!found) return bad(res, 404, "No such reference.");

    const { ep, ref } = found;
    ep.refs = ep.refs.filter(r => r.id !== ref.id);
    for (const scene of ep.scenes) scene.refIds = scene.refIds.filter(id => id !== ref.id);
    if (ref.file && path.resolve(ref.file).startsWith(path.resolve(p.dir))) {
      fs.rmSync(ref.file, { force: true });
    }
    store.save(p);
    res.json({ ok: true });
  });

  app.get("/api/series/workflows", async (_req, res) => {
    const url = opts.getComfyUrl();
    try {
      const r = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(8000) });
      res.json({ comfyUp: r.ok, comfyUrl: url });
    } catch {
      res.json({ comfyUp: false, comfyUrl: url });
    }
  });

  // -------------------------------------------------------------- generation

  function generateRef(p: Project, ep: Episode, ref: Ref) {
    return enqueue(p.id, { projectId: p.id, targetId: ref.id, kind: "ref", label: `${ep.title}: ${ref.name}` }, async job => {
      const fresh = store.get(p.id)!;
      const { info, graph } = await prepare(fresh, "ref");
      mark(p.id, ref.id, "ref", { status: "running", error: null });

      const dest = uniqueDestination(path.join(store.refsDir(fresh), `${ref.name.replace(/[^\w.-]+/g, "_")}.png`));
      await runWorkflow({
        baseUrl: opts.getComfyUrl(),
        workflow: graph,
        info,
        promptText: ref.prompt,
        // An image-to-image workflow draws the person in the photos it is given. With fewer photos than slots the photos repeat (a blank slot would fail).
        refImagePaths: (() => { const files = refSourceFiles(fresh.episodes.find(e => e.id === ep.id) || ep, ref); return info.refImageNodeIds.map((_, i) => (files.length ? files[i % files.length] : "")); })(),
        refVideoPaths: new Array(info.refVideoNodeIds.length).fill(""),
        refAudioPaths: new Array(info.refAudioNodeIds.length).fill(""),
        fieldValues: fieldValuesFor(info, fresh, "ref"),
        randomizeSeed: false,
        destFolder: path.dirname(dest),
        destFilename: path.basename(dest),
        onEvent: runEventSink(p.id, job),
        signal: job.abort.signal,
        onSubmitted: id => { job.promptId = id; },
      });

      mark(p.id, ref.id, "ref", { status: "done", file: dest, error: null });
      emit(p.id, { type: "finished", targetId: ref.id, kind: "ref", file: dest });
    });
  }

  function generateScene(p: Project, ep: Episode, scene: Scene) {
    return enqueue(p.id, { projectId: p.id, targetId: scene.id, kind: "scene", label: `${ep.title}: scene ${scene.number}` }, async job => {
      const fresh = store.get(p.id)!;
      const liveEp = fresh.episodes.find(e => e.id === ep.id)!;
      const liveScene = liveEp.scenes.find(s => s.id === scene.id)!;

      const refs = liveScene.refIds.map(id => liveEp.refs.find(r => r.id === id)).filter(Boolean) as Ref[];
      const missing = refs.filter(r => !r.file || !fs.existsSync(r.file));
      if (missing.length) throw new Error(`Render these references first: ${missing.map(r => r.name).join(", ")}`);

      const { info, graph } = await prepare(fresh, "scene");
      if (refs.length > info.refImageNodeIds.length) {
        throw new Error(`This scene uses ${refs.length} references but the workflow only has ${info.refImageNodeIds.length} slots.`);
      }

      const promptText = liveScene.promptEdited ? liveScene.promptText : buildScenePrompt(fresh, liveEp, liveScene);
      mark(p.id, scene.id, "scene", { status: "running", error: null, promptText });

      // Unused reference slots are passed blank, which bypasses them for this run.
      const refPaths = info.refImageNodeIds.map((_, i) => refs[i]?.file || "");
      const dest = uniqueDestination(path.join(store.clipsDir(fresh), `ep${String(liveEp.number).padStart(2, "0")}_scene${String(liveScene.number).padStart(2, "0")}.mp4`));

      await runWorkflow({
        baseUrl: opts.getComfyUrl(),
        workflow: graph,
        info,
        promptText,
        refImagePaths: refPaths,
        refVideoPaths: new Array(info.refVideoNodeIds.length).fill(""),
        refAudioPaths: new Array(info.refAudioNodeIds.length).fill(""),
        fieldValues: fieldValuesFor(info, fresh, "scene"),
        randomizeSeed: false,
        destFolder: path.dirname(dest),
        destFilename: path.basename(dest),
        onEvent: runEventSink(p.id, job),
        signal: job.abort.signal,
        onSubmitted: id => { job.promptId = id; mark(p.id, scene.id, "scene", { promptId: id }); },
      });

      const duration = await probeDuration(dest);
      mark(p.id, scene.id, "scene", { status: "done", clipPath: dest, durationS: duration, error: null });
      emit(p.id, { type: "finished", targetId: scene.id, kind: "scene", file: dest });
    });
  }

  app.post("/api/series/projects/:id/refs/:refId/generate", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findRef(p, req.params.refId);
    if (!found) return bad(res, 404, "No such reference.");
    generateRef(p, found.ep, found.ref);
    res.json({ ok: true });
  });

  app.post("/api/series/projects/:id/scenes/:sceneId/generate", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findScene(p, req.params.sceneId);
    if (!found) return bad(res, 404, "No such scene.");
    generateScene(p, found.ep, found.scene);
    res.json({ ok: true });
  });

  /** Queue everything an episode still needs: missing references first, then unrendered scenes. */
  app.post("/api/series/projects/:id/episodes/:episodeId/generate", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const ep = p.episodes.find(e => e.id === req.params.episodeId);
    if (!ep) return bad(res, 404, "No such episode.");
    const redo = !!req.body?.redo;

    const refs = ep.refs.filter(r => redo || r.status !== "done");
    const scenes = ep.scenes.filter(s => redo || s.status !== "done");
    for (const ref of refs) generateRef(p, ep, ref);
    for (const scene of scenes) generateScene(p, ep, scene);
    res.json({ queued: refs.length + scenes.length });
  });

  app.post("/api/series/projects/:id/cancel", async (req, res) => {
    const job = running.get(req.params.id);
    if (!job) return res.json({ ok: true, note: "Nothing running." });
    job.abort.abort();
    if (job.promptId) await cancelPrompt(opts.getComfyUrl(), job.promptId).catch(() => {});
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- assemble

  app.post("/api/series/projects/:id/episodes/:episodeId/stitch", async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const ep = p.episodes.find(e => e.id === req.params.episodeId);
    if (!ep) return bad(res, 404, "No such episode.");

    const ordered = [...ep.scenes].sort((a, b) => a.number - b.number);
    const unfinished = ordered.filter(s => s.status !== "done" || !s.clipPath);
    if (unfinished.length) return bad(res, 400, `${unfinished.length} scene(s) still need rendering.`);

    const name = `EP${String(ep.number).padStart(2, "0")}_${ep.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) || "episode"}.mp4`;
    const outFile = path.join(store.exportsDir(p), name);
    try {
      await stitch({
        clips: ordered.map(s => s.clipPath!),
        outFile,
        width: p.settings.width,
        height: p.settings.height,
        fps: p.settings.fps,
        onLine: line => emit(p.id, { type: "ffmpeg", text: line }),
      });
      ep.exportPath = outFile;
      store.save(p);
      emit(p.id, { type: "stitched", episodeId: ep.id, file: outFile });
      res.json({ file: outFile });
    } catch (e: any) {
      bad(res, 500, e?.message || String(e));
    }
  });

  // ------------------------------------------------------------ plan import

  /**
   * Replace the episode list with a plan produced in the Develop stage. The model writes the
   * plan, the UI posts it here, and this fills in ids, numbering and empty generation state so
   * nothing downstream has to cope with half-built objects.
   */
  app.post("/api/series/projects/:id/plan", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const incoming = Array.isArray(req.body?.episodes) ? req.body.episodes : null;
    if (!incoming) return bad(res, 400, "Expected an episodes array.");

    const keepRendered = !!req.body?.keepRendered;
    const oldByNumber = new Map(p.episodes.map(e => [e.number, e]));

    p.episodes = incoming.map((raw: Json, i: number): Episode => {
      const number = Number(raw.number) || i + 1;
      const old = keepRendered ? oldByNumber.get(number) : undefined;
      const refs: Ref[] = (Array.isArray(raw.refs) ? raw.refs : []).map((r: Json): Ref => {
        const prior = old?.refs.find(x => x.name === String(r.name));
        return {
          id: prior?.id || newId(),
          name: String(r.name || "reference"),
          role: r.role === "style" ? "style" : "character",
          prompt: String(r.prompt || ""),
          negative: String(r.negative || ""),
          seed: Number(r.seed) || Math.floor(Math.random() * 100000),
          file: prior?.file || null,
          status: (prior?.status as Status) || "pending",
          error: null,
        };
      });

      return {
        id: old?.id || newId(),
        number,
        title: String(raw.title || `Episode ${number}`),
        era: String(raw.era || ""),
        hookOut: String(raw.hookOut || ""),
        refs,
        exportPath: old?.exportPath || null,
        scenes: (Array.isArray(raw.scenes) ? raw.scenes : []).map((s: Json, j: number): Scene => {
          const sceneNumber = Number(s.number) || j + 1;
          const prior = old?.scenes.find(x => x.number === sceneNumber);
          const refIds = (Array.isArray(s.refs) ? s.refs : [])
            .map((name: string) => refs.find(r => r.name === name)?.id)
            .filter(Boolean) as string[];
          return {
            id: prior?.id || newId(),
            number: sceneNumber,
            vo: String(s.vo || ""),
            shot: String(s.shot || ""),
            textCard: String(s.textCard || ""),
            refIds: refIds.length ? refIds : refs.filter(r => r.role === "style").map(r => r.id),
            seed: Number(s.seed) || Math.floor(Math.random() * 100000),
            promptText: prior?.promptText || "",
            promptEdited: prior?.promptEdited || false,
            status: (prior?.status as Status) || "pending",
            clipPath: prior?.clipPath || null,
            durationS: prior?.durationS || null,
            promptId: null,
            error: null,
          };
        }),
      };
    });

    store.save(p);
    res.json(p);
  });

  return { store };
}
          fromRefIds: prior?.fromRefIds,
          kind: refKindInfo(String(r.kind || prior?.kind || ""))?.id,
