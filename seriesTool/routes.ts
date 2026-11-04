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
import { freeOllamaForComfy } from "../gpuHandoff";
import express from "express";
import fs from "fs";
import path from "path";
import { loadApiWorkflow, loadWorkflowInfo, type WorkflowInfo } from "../comfyTool/registry";
import { runWorkflow, cancelPrompt, uniqueDestination, type RunEvent } from "../comfyTool/runner";
import { probeDuration, stitch, buildTalkingTrimArgs, buildTalkingPieceArgs, buildTalkingConcatArgs, buildJoinArgs, runFfmpeg } from "./ffmpeg";
import { MAX_CHUNKS, TALK_TAIL, TALK_WARNING, TALK_WORKFLOW, MAX_TALK_SECONDS, isTalking, joinVoice, limitChunks, pickTalkingPicture, planTalking, talkingPrompt, talkingSize, isMultiSpeaker, turnsMatchVoice, pieceLengths, planTurnRenders, pickTurnPicture, TURN_GAP, failedRenderState, joinWarnings, type TurnRender } from "./talking";
import { takesIn, unusedTakes } from "./takes";
import { upsertOutput } from "./finishCore";
import { extractUpload } from "../comfyTool/extract";
import { fillSlots, refSourceFiles } from "./refSources";
import { refKindInfo } from "./refKinds";
import { buildScenePrompt, newId, snapFrames, type Episode, type Project, type Ref, type Scene, type Source, type Status } from "./model";
import { createSeriesStore } from "./store";
import { isRunning } from "../trainTool/jobs";
import { voiceStarting } from "../trainTool/voice";
import { importLines, joinLines, usesAiVoice } from "./voices";
import { voiceStamp } from "./voiceTrack";

type Json = Record<string, any>;

export interface SeriesOptions {
  /** Where project folders live. */
  projectsRoot: string;
  getComfyUrl: () => string;
  /** The ComfyUI portable folder, if known: the talking-video workflow is looked for in its workflows folder. */
  getComfyRoot?: () => string | null;
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
  /** Jobs waiting behind the one on the GPU, so a cancel can drop them too. */
  const queued = new Map<string, Job[]>();
  const listeners = new Map<string, Set<express.Response>>();

  /** Watchers of every series at once (the app's notifier), told which series and title each event is about. */
  const everyone = new Set<express.Response>();
  /** Clips and pictures finished or failed since this project's queue last went quiet, for one "all done" notice. */
  const batch = new Map<string, { done: number; failed: number }>();

  const emit = (projectId: string, event: Json) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of listeners.get(projectId) || []) res.write(payload);
    if (everyone.size) {
      const wide = `data: ${JSON.stringify({ ...event, projectId, title: store.get(projectId)?.title || "" })}\n\n`;
      for (const res of everyone) res.write(wide);
    }
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

  // Nodes whose width/height/length really set the generated picture or clip, and the nodes that
  // carry the frame rate. Same split the workflow registry uses.
  const SIZE_CLASS = /Latent|ToVideo|FirstLastFrame|CameraEmbedding/i;
  const FPS_CLASS = /CreateVideo|VideoCombine|SaveAnimated|SaveVideo|LTXVConditioning/i;
  const LENGTH_KEYS = ["length", "num_frames", "video_frames", "frames_number", "frame_count"];

  /**
   * Write the project's size and duration straight into the graph.
   *
   * `fieldValues` alone is not enough: in a workflow where width/height/length are fed by other
   * nodes (a resolution picker, a seconds-to-frames expression) they are links rather than
   * widgets, so the registry never exposes them as fields and the workflow's own defaults win
   * silently - which is how a vertical 7s series once rendered as a 1152x640 5s clip. Setting a
   * literal here replaces the link, and the now-unused upstream nodes are pruned before the run.
   */
  function forceSizeAndLength(graph: Json, size: { width: number; height: number; length?: number; fps?: number }) {
    for (const node of Object.values<any>(graph)) {
      const cls = String(node?.class_type || "");
      const inputs = node?.inputs;
      if (!inputs) continue;
      if (SIZE_CLASS.test(cls)) {
        if ("width" in inputs) inputs.width = size.width;
        if ("height" in inputs) inputs.height = size.height;
        if (size.length !== undefined) {
          for (const key of LENGTH_KEYS) if (key in inputs) inputs[key] = size.length;
        }
      }
      if (size.fps !== undefined && FPS_CLASS.test(cls)) {
        for (const key of ["fps", "frame_rate"]) if (key in inputs) inputs[key] = size.fps;
      }
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

  /** What each queued job does, the projects whose queue is paused, and the workers running now. */
  const works = new WeakMap<Job, (job: Job) => Promise<void>>();
  const paused = new Set<string>();
  const pumping = new Set<string>();
  /** How long pictures and clips took lately (ms), for the queue's time estimates. */
  const took: Record<"ref" | "scene", number[]> = { ref: [], scene: [] };

  /** Queue one job behind whatever this project is already doing. */
  function enqueue(projectId: string, job: Omit<Job, "abort" | "promptId" | "progress">, work: (job: Job) => Promise<void>) {
    const full: Job = { ...job, abort: new AbortController(), promptId: null, progress: null };
    works.set(full, work);
    queued.set(projectId, [...(queued.get(projectId) || []), full]);
    mark(projectId, full.targetId, full.kind, { status: "queued", error: null });
    void pump(projectId);
    return full;
  }

  /** Runs this project's queue one job at a time, in the list's current order, until it is empty or paused. */
  async function pump(projectId: string) {
    if (pumping.has(projectId)) return;
    pumping.add(projectId);
    try {
      for (;;) {
        if (paused.has(projectId)) break;
        const list = queued.get(projectId) || [];
        const full = list.shift();
        if (!full) break;
        queued.set(projectId, list);
        if (full.abort.signal.aborted) continue;
        await runJob(projectId, full);
      }
    } finally { pumping.delete(projectId); }
  }

  async function runJob(projectId: string, full: Job) {
    const work = works.get(full)!;
    const t0 = Date.now();
    {
      running.set(projectId, full);
      emit(projectId, { type: "started", targetId: full.targetId, kind: full.kind, label: full.label });
      try {
        await freeOllamaForComfy(); // the render needs the GPU: Ollama lets go of its models first
        await work(full);
        const b = batch.get(projectId) || { done: 0, failed: 0 };
        batch.set(projectId, { ...b, done: b.done + 1 });
        took[full.kind] = [...took[full.kind], Date.now() - t0].slice(-8);
      } catch (e: any) {
        const message = full.abort.signal.aborted ? "Cancelled." : (e?.message || String(e));
        // A scene or picture that already had a good result keeps it (and stays done, so joining is not blocked);
        // the failure is still reported below.
        const cur = store.get(projectId);
        const item: any = cur && (full.kind === "scene" ? findScene(cur, full.targetId)?.scene : findRef(cur, full.targetId)?.ref);
        const had = item && (full.kind === "scene" ? item.clipPath : item.file);
        const keep = !!had && fs.existsSync(had);
        mark(projectId, full.targetId, full.kind, failedRenderState(keep, full.abort.signal.aborted, message));
        emit(projectId, { type: "failed", targetId: full.targetId, error: failedRenderState(keep, full.abort.signal.aborted, message).error ?? message });
        if (!full.abort.signal.aborted) {
          const b = batch.get(projectId) || { done: 0, failed: 0 };
          batch.set(projectId, { ...b, failed: b.failed + 1 });
        }
      } finally {
        if (running.get(projectId) === full) running.delete(projectId);
        // Nothing left waiting: say how the run went, once.
        if (!(queued.get(projectId) || []).length && !running.has(projectId)) {
          const b = batch.get(projectId);
          batch.delete(projectId);
          if (b && (b.done || b.failed)) emit(projectId, { type: "idle", done: b.done, failed: b.failed });
        }
      }
    }
  }

  const avg = (l: number[]) => (l.length ? Math.round(l.reduce((a, x) => a + x, 0) / l.length) : null);

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
        archived: !!p.archived,
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

  /** Live job events for every series, for notifications. */
  app.get("/api/series/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": open\n\n");
    everyone.add(res);
    const beat = setInterval(() => res.write(": beat\n\n"), 25_000);
    req.on("close", () => { clearInterval(beat); everyone.delete(res); });
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
      person: String(req.query.person || "").trim().slice(0, 60) || undefined,
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

  const newSeed = () => Math.floor(Math.random() * 1e9);

  function generateRef(p: Project, ep: Episode, ref: Ref) {
    return enqueue(p.id, { projectId: p.id, targetId: ref.id, kind: "ref", label: `${ep.title}: ${ref.name}` }, async job => {
      const fresh = store.get(p.id)!;
      const { info, graph } = await prepare(fresh, "ref");
      forceSizeAndLength(graph, { width: fresh.settings.width, height: fresh.settings.height });
      // A picture that was already made is being made again, so it gets a new seed (the same seed and prompt would
      // give back the same picture). The seed used is stored, so a picture can be traced back to it.
      const liveRef = fresh.episodes.flatMap(e => e.refs).find(r => r.id === ref.id) || ref;
      const seed = liveRef.file && liveRef.prompt.trim() ? newSeed() : liveRef.seed;
      mark(p.id, ref.id, "ref", { status: "running", error: null, seed });

      const dest = uniqueDestination(path.join(store.refsDir(fresh), `${ref.name.replace(/[^\w.-]+/g, "_")}.png`));
      await runWorkflow({
        baseUrl: opts.getComfyUrl(),
        workflow: graph,
        info,
        promptText: ref.prompt,
        // An image-to-image workflow draws the person in the photos it is given. With fewer photos than slots the photos repeat (a blank slot would fail).
        refImagePaths: fillSlots(refSourceFiles(fresh.episodes.find(e => e.id === ep.id) || ep, ref), info.refImageBypassable, info.refImageNodeIds.length),
        refVideoPaths: new Array(info.refVideoNodeIds.length).fill(""),
        refAudioPaths: new Array(info.refAudioNodeIds.length).fill(""),
        fieldValues: fieldValuesFor(info, fresh, "ref"),
        seed,
        destFolder: path.dirname(dest),
        destFilename: path.basename(dest),
        onEvent: runEventSink(p.id, job),
        signal: job.abort.signal,
        onSubmitted: id => { job.promptId = id; },
      });

      // A cancelled run returns without a file; it must not be recorded as finished.
      if (job.abort.signal.aborted || !fs.existsSync(dest)) throw new Error(job.abort.signal.aborted ? "Cancelled." : "ComfyUI finished without saving a picture.");
      mark(p.id, ref.id, "ref", { status: "done", file: dest, error: null });
      emit(p.id, { type: "finished", targetId: ref.id, kind: "ref", file: dest });
    });
  }

  function generateScene(p: Project, ep: Episode, scene: Scene) {
    return enqueue(p.id, { projectId: p.id, targetId: scene.id, kind: "scene", label: `${ep.title}: scene ${scene.number}` }, async job => {
      const fresh = store.get(p.id)!;
      const liveEp = fresh.episodes.find(e => e.id === ep.id)!;
      const liveScene = liveEp.scenes.find(s => s.id === scene.id)!;

      // Pictures marked "skip" are left out, as if they were not attached.
      const refs = liveScene.refIds.map(id => liveEp.refs.find(r => r.id === id)).filter((r): r is Ref => !!r && !r.skip);
      const missing = refs.filter(r => !r.file || !fs.existsSync(r.file));
      if (missing.length) throw new Error(`Render these references first: ${missing.map(r => r.name).join(", ")}`);

      const { info, graph } = await prepare(fresh, "scene");
      forceSizeAndLength(graph, {
        width: fresh.settings.width,
        height: fresh.settings.height,
        length: snapFrames(fresh.settings.seconds, fresh.settings.fps),
        fps: fresh.settings.fps,
      });
      if (refs.length > info.refImageNodeIds.length) {
        throw new Error(`This scene uses ${refs.length} references but the workflow only has ${info.refImageNodeIds.length} slots.`);
      }

      const promptText = liveScene.promptEdited ? liveScene.promptText : buildScenePrompt(fresh, liveEp, liveScene);
      // Rendering a scene again: a new seed, or ComfyUI hands back the same clip from its cache.
      const seed = liveScene.clipPath ? newSeed() : liveScene.seed;
      mark(p.id, scene.id, "scene", { status: "running", error: null, promptText, seed });

      // Unused reference slots are passed blank, which bypasses them for this run.
      const refPaths = fillSlots(refs.map(r => r.file || ""), info.refImageBypassable, info.refImageNodeIds.length);
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
        seed,
        destFolder: path.dirname(dest),
        destFilename: path.basename(dest),
        onEvent: runEventSink(p.id, job),
        signal: job.abort.signal,
        onSubmitted: id => { job.promptId = id; mark(p.id, scene.id, "scene", { promptId: id }); },
      });

      if (job.abort.signal.aborted || !fs.existsSync(dest)) throw new Error(job.abort.signal.aborted ? "Cancelled." : "ComfyUI finished without saving a clip.");
      const duration = await probeDuration(dest);
      mark(p.id, scene.id, "scene", { status: "done", clipPath: dest, durationS: duration, error: null });
      emit(p.id, { type: "finished", targetId: scene.id, kind: "scene", file: dest });
    });
  }

  // ---------------------------------------------------------- talking video

  /** The S2V workflow file: the API copy first, else the saved one (read only, never written). */
  function talkingWorkflowFile(): string | null {
    const root = opts.getComfyRoot?.();
    if (!root) return null;
    // The API copy and the saved one may differ: the newer file wins, so edits made in ComfyUI are not ignored.
    const files = ["ComfyUI", ""].flatMap(sub => [path.join(root, sub, "user", "default", "workflows")]).flatMap(dir => [path.join(dir, "API_FORMAT", TALK_WORKFLOW), path.join(dir, TALK_WORKFLOW)]).filter(f => fs.existsSync(f));
    return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  }
  const comfyIsUp = async () => { try { return (await fetch(`${opts.getComfyUrl()}/system_stats`, { signal: AbortSignal.timeout(6000) })).ok; } catch { return false; } };

  /** Whether the "Make talking video" button can work, and why not. */
  app.get("/api/series/talking/status", async (_req, res) => {
    const file = talkingWorkflowFile();
    const comfyUp = await comfyIsUp();
    const reason = !comfyUp ? "ComfyUI is not running. Start it, then try again." : !file ? `The workflow "${TALK_WORKFLOW}" was not found in ComfyUI's workflows folder.` : "";
    res.json({ ready: !reason, reason, comfyUp, workflow: file, maxSeconds: MAX_TALK_SECONDS, warning: TALK_WARNING });
  });

  /** Render one scene as a talking video: its voice file + a picture of the speaker, through the S2V workflow, queued like any clip. */
  app.post("/api/series/projects/:id/scenes/:sceneId/talking", async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findScene(p, req.params.sceneId);
    if (!found) return bad(res, 404, "No such scene.");
    const { ep, scene } = found;
    if (scene.status === "running" || scene.status === "queued") return bad(res, 409, "This scene is rendering right now. Cancel it first.");
    if (!scene.voiceFile || !fs.existsSync(scene.voiceFile)) return bad(res, 400, "Make this scene's voice first (the Voices card).");
    // XTTS voice with turns by 2+ speakers: one render per turn, each with that speaker's picture (everything else below is the one-picture path)
    let multi: (TurnRender & { picture: string })[] | undefined;
    const voiceNow = scene.voiceFile ? await probeDuration(scene.voiceFile) : null;
    // turns that no longer belong to the voice file (a Dia redo, a copied project) are ignored: the one-picture path
    const turnsOk = isMultiSpeaker(scene.voiceTurns) && !!voiceNow && turnsMatchVoice(scene.voiceTurns!, voiceNow);
    if (turnsOk && scene.voiceText !== voiceStamp(p, ep, scene)) return bad(res, 400, "The speakers or words of this scene changed since its voice was made. Make the voice again first.");
    if (turnsOk) {
      const tp = planTurnRenders(scene.voiceTurns!);
      if ("reason" in tp) return bad(res, 400, tp.reason);
      const gone = scene.voiceTurns!.find(t => !fs.existsSync(t.file));
      if (gone) return bad(res, 400, "A speaker's turn file of this scene's voice is gone. Make the voice again (Redo).");
      multi = [];
      for (const r of tp.renders) {
        const pic = pickTurnPicture(ep.refs, scene, r.speaker, f => fs.existsSync(f));
        if ("reason" in pic) return bad(res, 400, pic.reason);
        multi.push({ ...r, picture: pic.ref.file! });
      }
    }
    const voiceS = await probeDuration(scene.voiceFile);
    if (!voiceS) return bad(res, 400, "Could not read the length of this scene's voice file.");
    const plan = planTalking(voiceS);
    if (!multi && plan.tooLong) return bad(res, 400, `This voice is ${voiceS.toFixed(1)} s but a talking video can carry at most ${plan.maxSeconds.toFixed(1)} s. Nothing is cut: split the scene or shorten its words, then make the voice again.`);
    const pic = multi ? { ref: { name: [...new Set(multi.map(m => m.speaker || "narrator"))].join(", "), file: multi[0].picture } } : pickTalkingPicture(ep.refs, scene, f => fs.existsSync(f));
    if ("reason" in pic) return bad(res, 400, pic.reason);
    const wf = talkingWorkflowFile();
    if (!wf) return bad(res, 400, `The workflow "${TALK_WORKFLOW}" was not found in ComfyUI's workflows folder.`);
    if (!(await comfyIsUp())) return bad(res, 503, "ComfyUI is not running. Start it, then try again.");
    if (voiceStarting() || isRunning("dia") || isRunning("xtts") || isRunning("seriesvoice")) return bad(res, 409, "A voice is being made right now and needs the graphics card. Wait for it to finish, then try again.");
    generateTalking(p, ep, scene, { workflow: wf, picture: pic.ref.file!, renders: multi });
    res.json({ ok: true, chunks: multi ? multi.reduce((n, m) => n + planTalking(m.seconds).chunks, 0) : plan.chunks, voiceSeconds: voiceS, picture: pic.ref.name, renders: multi?.length ?? 1 });
  });

  /** Go back to the normal clip the scene had before its talking video. The talking clip stays on disk as a take. */
  app.post("/api/series/projects/:id/scenes/:sceneId/talking/revert", async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findScene(p, req.params.sceneId);
    if (!found) return bad(res, 404, "No such scene.");
    const s = found.scene;
    if (s.status === "running" || s.status === "queued") return bad(res, 409, "This scene is rendering right now. Cancel it first.");
    if (!isTalking(s)) return bad(res, 400, "This scene is not using a talking clip.");
    if (!s.clipBeforeTalking || !fs.existsSync(s.clipBeforeTalking)) return bad(res, 400, "There is no normal clip to go back to (the scene had none before the talking video). Render the scene normally instead.");
    mark(p.id, s.id, "scene", { status: "done", clipPath: s.clipBeforeTalking, durationS: await probeDuration(s.clipBeforeTalking), talking: false, error: null });
    res.json({ ok: true, clipPath: s.clipBeforeTalking });
  });

  /** One S2V render of `audio` (`seconds` long) with `picture`: returns the raw ComfyUI clip in the clips folder (the caller trims it and removes it). */
  async function renderTalkRaw(job: Job, p: Project, liveEp: Episode, live: Scene, a: { workflow: string; picture: string; audio: string; seconds: number; seed: number }): Promise<string> {
    const fresh = store.get(p.id)!;
    const plan = planTalking(a.seconds);
    if (plan.tooLong) throw new Error(`This voice is ${a.seconds.toFixed(1)} s but a talking video can carry at most ${plan.maxSeconds.toFixed(1)} s. Nothing is cut.`);
    const oi = await objectInfo();
    const info = loadWorkflowInfo(a.workflow, {}, oi);
    if (!info.isRunnable) throw new Error(`The talking-video workflow cannot run: ${info.missing.join(", ") || "unknown reason"}`);
    if (info.refImageNodeIds.length !== 1 || info.refAudioNodeIds.length !== 1) throw new Error("The talking-video workflow was changed: it needs exactly one picture and one audio input.");
    const { graph } = loadApiWorkflow(a.workflow, oi);
    const size = talkingSize(fresh.settings.width, fresh.settings.height);
    forceSizeAndLength(graph, size); // sets the width/height of the S2V node only; its length and 16 fps stay
    // Fewer chunks = far less GPU time for a short voice. If the graph cannot be shortened, stop rather than silently run all three (about 3x the GPU time).
    if (plan.chunks < MAX_CHUNKS && !limitChunks(graph, plan.chunks)) throw new Error("The talking-video workflow was changed, so it cannot be shortened for a short voice (it would run 3 times longer). Re-export it with the same nodes, or use a longer voice.");

    // The picture on the video's shape (cropped round the face, not stretched), so the model gets what it will draw.
    const sharp = (await import("sharp")).default;
    const cropped = path.join(fresh.dir, "talking", `${live.id.replace(/[^A-Za-z0-9_-]/g, "_")}.png`);
    fs.mkdirSync(path.dirname(cropped), { recursive: true });
    await sharp(a.picture).rotate().resize(size.width, size.height, { fit: "cover", position: sharp.strategy.attention }).png().toFile(cropped);

    mark(p.id, live.id, "scene", { status: "running", error: null, seed: a.seed });
    const clips = store.clipsDir(fresh);
    const base = `ep${String(liveEp.number).padStart(2, "0")}_scene${String(live.number).padStart(2, "0")}`;
    const raw = path.join(clips, `${base}_talkraw.mp4`);
    fs.mkdirSync(clips, { recursive: true });
    fs.rmSync(raw, { force: true });
    await runWorkflow({
      baseUrl: opts.getComfyUrl(),
      workflow: graph,
      info,
      promptText: talkingPrompt(live.shot, fresh.styleLock),
      refImagePaths: [cropped],
      refVideoPaths: new Array(info.refVideoNodeIds.length).fill(""),
      refAudioPaths: [a.audio],
      fieldValues: {},
      seed: a.seed,
      destFolder: clips,
      destFilename: path.basename(raw),
      onEvent: runEventSink(p.id, job),
      signal: job.abort.signal,
      onSubmitted: id => { job.promptId = id; mark(p.id, live.id, "scene", { promptId: id }); },
    });
    if (job.abort.signal.aborted || !fs.existsSync(raw)) {
      // The runner may have saved the file under another extension; only this feature's own _talkraw files are removed.
      for (const f of fs.readdirSync(clips)) if (f.startsWith(`${base}_talkraw.`)) fs.rmSync(path.join(clips, f), { force: true });
      throw new Error(job.abort.signal.aborted ? "Cancelled." : "ComfyUI finished without saving a clip.");
    }
    return raw;
  }

  function generateTalking(p: Project, ep: Episode, scene: Scene, a: { workflow: string; picture: string; renders?: (TurnRender & { picture: string })[] }) {
    return enqueue(p.id, { projectId: p.id, targetId: scene.id, kind: "scene", label: `${ep.title}: scene ${scene.number} (talking${a.renders ? `, ${a.renders.length} renders` : ""})` }, async job => {
      const fresh = store.get(p.id)!;
      const liveEp = fresh.episodes.find(e => e.id === ep.id)!;
      const live = liveEp.scenes.find(s => s.id === scene.id)!;
      // The length is read from the voice file as it is now (not when the job was queued).
      if (!live.voiceFile || !fs.existsSync(live.voiceFile)) throw new Error("This scene's voice file is gone. Make the voice again.");
      const voiceS = await probeDuration(live.voiceFile);
      if (!voiceS) throw new Error("Could not read the length of this scene's voice file.");
      const seed = live.clipPath ? newSeed() : live.seed; // a new seed, or ComfyUI hands back its cached clip
      const clips = store.clipsDir(fresh);
      const base = `ep${String(liveEp.number).padStart(2, "0")}_scene${String(live.number).padStart(2, "0")}`;
      const dest = uniqueDestination(path.join(clips, `${base}.mp4`));

      if (!a.renders) {
        const raw = await renderTalkRaw(job, p, liveEp, live, { workflow: a.workflow, picture: a.picture, audio: live.voiceFile, seconds: voiceS, seed });
        // Cut to the voice (+ a short tail) with the voice at the loudness mixed voices get; the raw model output is not kept.
        try { await runFfmpeg(buildTalkingTrimArgs(raw, dest, voiceS + TALK_TAIL), job.abort.signal); } catch (e) { fs.rmSync(dest, { force: true }); throw e; } finally { fs.rmSync(raw, { force: true }); }
      } else {
        // One render per speaker turn, in order; each piece is cut to its turn + the join gap (the last: + the tail), so the pieces together line up with the joined voice. Only this job's own temp files are removed.
        const renders = a.renders;
        const mine: string[] = [];
        const pieces: string[] = [];
        try {
          // the turns are read again now: the voice may have been made again since the button was pressed
          const tp = isMultiSpeaker(live.voiceTurns) && turnsMatchVoice(live.voiceTurns!, voiceS) ? planTurnRenders(live.voiceTurns!) : { reason: "This scene's voice no longer has several speakers. Press the button again." };
          if ("reason" in tp) throw new Error(tp.reason);
          if (tp.renders.length !== renders.length || tp.renders.some((r, i) => r.files.join("|") !== renders[i].files.join("|") || r.speaker !== renders[i].speaker || Math.abs(r.seconds - renders[i].seconds) > 0.01)) throw new Error("The scene's voice was made again while this was waiting. Press the button again.");
          const cuts = pieceLengths(renders.map(r => r.seconds));
          for (const [i, r] of renders.entries()) {
            emit(p.id, { type: "note", targetId: scene.id, text: `render ${i + 1} of ${renders.length}: ${r.speaker || "narrator"}` });
            let audio = r.files[0];
            if (r.files.length > 1) { // neighbouring turns of one speaker, joined the same way the scene voice is
              audio = path.join(fresh.dir, "talking", `${live.id.replace(/[^A-Za-z0-9_-]/g, "_")}_audio${i}.wav`);
              fs.mkdirSync(path.dirname(audio), { recursive: true }); mine.push(audio);
              await runFfmpeg(buildJoinArgs(r.files, audio, TURN_GAP), job.abort.signal);
            }
            const raw = await renderTalkRaw(job, p, liveEp, live, { workflow: a.workflow, picture: r.picture, audio, seconds: r.seconds, seed });
            const piece = path.join(clips, `${base}_talkpart${i}.mp4`);
            mine.push(piece);
            try { await runFfmpeg(buildTalkingPieceArgs(raw, piece, cuts[i]), job.abort.signal); } finally { fs.rmSync(raw, { force: true }); }
            pieces.push(piece);
          }
          try { await runFfmpeg(buildTalkingConcatArgs(pieces, dest), job.abort.signal); } catch (e) { fs.rmSync(dest, { force: true }); throw e; }
        } finally { for (const f of mine) fs.rmSync(f, { force: true }); }
      }
      if (job.abort.signal.aborted) { fs.rmSync(dest, { force: true }); throw new Error("Cancelled."); }
      const duration = await probeDuration(dest);
      mark(p.id, scene.id, "scene", { status: "done", clipPath: dest, durationS: duration, error: null, talking: true, talkingClip: dest, talkingVoice: live.voiceText ?? "", clipBeforeTalking: isTalking(live) ? live.clipBeforeTalking ?? null : live.clipPath });
      emit(p.id, { type: "finished", targetId: scene.id, kind: "scene", file: dest });
    });
  }

  app.post("/api/series/projects/:id/refs/:refId/generate", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findRef(p, req.params.refId);
    if (!found) return bad(res, 404, "No such reference.");
    // An attached photo has no prompt: rendering it would replace the photo with a made-up picture.
    if (found.ref.file && !found.ref.prompt.trim()) return bad(res, 409, "This is an attached picture. It is used as it is and is never rendered.");
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

  /** Use a finished video (from the Video studio, say) as a scene's clip instead of rendering one. */
  app.post("/api/series/projects/:id/scenes/:sceneId/clip", express.raw({ type: "*/*", limit: "2gb" }), async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findScene(p, req.params.sceneId);
    if (!found) return bad(res, 404, "No such scene.");
    if (found.scene.status === "running" || found.scene.status === "queued") return bad(res, 409, "This scene is rendering right now. Cancel it first.");
    if (path.extname(String(req.query.name || "")).toLowerCase() !== ".mp4") return bad(res, 400, "Attach an MP4 video.");
    if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 400, "That file was empty.");
    const dest = uniqueDestination(path.join(store.clipsDir(p), `ep${String(found.ep.number).padStart(2, "0")}_scene${String(found.scene.number).padStart(2, "0")}.mp4`));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, req.body);
    mark(p.id, found.scene.id, "scene", { status: "done", clipPath: dest, durationS: await probeDuration(dest), error: null });
    emit(p.id, { type: "finished", targetId: found.scene.id, kind: "scene", file: dest });
    res.json({ ok: true, clipPath: dest });
  });

  /** Every take of each scene of an episode (all renders are kept), so one can be picked for the join. */
  app.get("/api/series/projects/:id/episodes/:episodeId/takes", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const ep = p.episodes.find(e => e.id === req.params.episodeId);
    if (!ep) return bad(res, 404, "No such episode.");
    const out: Record<string, { path: string; at: number }[]> = {};
    for (const s of ep.scenes) out[s.id] = takesIn(store.clipsDir(p), ep.number, s.number);
    res.json({ takes: out });
  });

  /** Use an earlier (or later) take of a scene as its clip. */
  app.post("/api/series/projects/:id/scenes/:sceneId/take", async (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findScene(p, req.params.sceneId);
    if (!found) return bad(res, 404, "No such scene.");
    if (found.scene.status === "running" || found.scene.status === "queued") return bad(res, 409, "This scene is rendering right now.");
    const take = takesIn(store.clipsDir(p), found.ep.number, found.scene.number).find(t => path.resolve(t.path) === path.resolve(String(req.body?.path || "")));
    if (!take) return bad(res, 400, "That is not a take of this scene.");
    mark(p.id, found.scene.id, "scene", { status: "done", clipPath: take.path, durationS: await probeDuration(take.path), error: null });
    res.json({ ok: true });
  });

  /** Delete one take a scene does not use. */
  app.delete("/api/series/projects/:id/scenes/:sceneId/take", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const found = findScene(p, req.params.sceneId);
    if (!found) return bad(res, 404, "No such scene.");
    const take = takesIn(store.clipsDir(p), found.ep.number, found.scene.number).find(t => path.resolve(t.path) === path.resolve(String(req.body?.path || "")));
    if (!take) return bad(res, 400, "That is not a take of this scene.");
    if (found.scene.clipPath && path.resolve(found.scene.clipPath).toLowerCase() === path.resolve(take.path).toLowerCase()) return bad(res, 400, "This take is the one the scene uses. Pick another take first.");
    if ([found.scene.clipBeforeTalking, found.scene.talkingClip].some(f => f && path.resolve(f).toLowerCase() === path.resolve(take.path).toLowerCase())) return bad(res, 400, "This take belongs to the scene's talking video (the talking clip or the clip to go back to). Use Back to normal clip, or render the scene again, first.");
    fs.rmSync(take.path, { force: true });
    res.json({ ok: true });
  });

  /** How many takes no scene uses, and their size; POST deletes them. */
  app.get("/api/series/projects/:id/unused-takes", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const list = unusedTakes(store.clipsDir(p), p.episodes);
    res.json({ count: list.length, bytes: list.reduce((n, t) => n + fs.statSync(t.path).size, 0) });
  });
  app.post("/api/series/projects/:id/unused-takes/delete", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const list = unusedTakes(store.clipsDir(p), p.episodes);
    let bytes = 0;
    for (const t of list) { bytes += fs.statSync(t.path).size; fs.rmSync(t.path, { force: true }); }
    res.json({ count: list.length, bytes });
  });

  /** Queue everything an episode still needs: missing references first, then unrendered scenes. */
  app.post("/api/series/projects/:id/episodes/:episodeId/generate", (req, res) => {
    const p = store.get(req.params.id);
    if (!p) return bad(res, 404, "No such project.");
    const ep = p.episodes.find(e => e.id === req.params.episodeId);
    if (!ep) return bad(res, 404, "No such episode.");
    const redo = !!req.body?.redo;

    // Attached pictures (a file and no prompt) are used as they are; "render again" must never replace them.
    const refs = ep.refs.filter(r => !(r.file && !r.prompt.trim()) && (redo || r.status !== "done"));
    const scenes = ep.scenes.filter(s => redo || s.status !== "done");
    for (const ref of refs) generateRef(p, ep, ref);
    for (const scene of scenes) generateScene(p, ep, scene);
    res.json({ queued: refs.length + scenes.length });
  });

  /** The render queue: what runs now, what waits (in order), whether it is paused, and how long a picture or clip took lately. */
  app.get("/api/series/projects/:id/queue", (req, res) => {
    const id = req.params.id;
    const r = running.get(id);
    res.json({
      paused: paused.has(id),
      running: r ? { targetId: r.targetId, kind: r.kind, label: r.label, progress: r.progress } : null,
      waiting: (queued.get(id) || []).filter(j => !j.abort.signal.aborted).map(j => ({ targetId: j.targetId, kind: j.kind, label: j.label })),
      avgMs: { ref: avg(took.ref), scene: avg(took.scene) },
    });
  });

  /** Move a waiting job: up, down, to the top or to the bottom. */
  app.post("/api/series/projects/:id/queue/move", (req, res) => {
    const id = req.params.id, list = [...(queued.get(id) || [])];
    const i = list.findIndex(j => j.targetId === req.body?.targetId);
    if (i < 0) return bad(res, 404, "That job is not waiting in the queue.");
    const [job] = list.splice(i, 1);
    const to = String(req.body?.to || "");
    const at = to === "top" ? 0 : to === "bottom" ? list.length : to === "up" ? Math.max(0, i - 1) : Math.min(list.length, i + 1);
    list.splice(at, 0, job);
    queued.set(id, list);
    res.json({ ok: true });
  });

  /** Take one waiting job out of the queue (the picture or clip goes back to "not rendered"). */
  app.post("/api/series/projects/:id/queue/remove", (req, res) => {
    const id = req.params.id, list = queued.get(id) || [];
    const job = list.find(j => j.targetId === req.body?.targetId);
    if (!job) return bad(res, 404, "That job is not waiting in the queue.");
    job.abort.abort();
    queued.set(id, list.filter(j => j !== job));
    mark(id, job.targetId, job.kind, { status: "pending", error: null });
    res.json({ ok: true });
  });

  /** Pause the queue (the job on the GPU finishes, nothing new starts) or carry on. */
  app.post("/api/series/projects/:id/queue/pause", (req, res) => {
    const id = req.params.id;
    if (req.body?.paused) paused.add(id); else { paused.delete(id); void pump(id); }
    res.json({ ok: true, paused: paused.has(id) });
  });

  /** Stop the job on the GPU and drop everything still waiting behind it for this project. */
  app.post("/api/series/projects/:id/cancel", async (req, res) => {
    const id = req.params.id;
    const waiting = queued.get(id) || [];
    for (const job of waiting) {
      job.abort.abort();
      mark(id, job.targetId, job.kind, { status: "pending", error: null });
    }
    queued.set(id, []);

    const job = running.get(id);
    if (!job) return res.json({ ok: true, cancelled: waiting.length, note: waiting.length ? "Queue cleared." : "Nothing running." });
    job.abort.abort();
    if (job.promptId) await cancelPrompt(opts.getComfyUrl(), job.promptId).catch(() => {});
    res.json({ ok: true, cancelled: waiting.length + 1 });
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
        // Made voices (Dia or XTTS) go over their clips, which are turned down so the model's own speech does not double them. A talking clip already carries its voice: nothing is laid over it.
        voices: usesAiVoice(p) ? ordered.map(joinVoice) : undefined,
        outFile,
        width: p.settings.width,
        height: p.settings.height,
        fps: p.settings.fps,
        onLine: line => emit(p.id, { type: "ffmpeg", text: line }),
      });
      // Record when it was joined, so players load the new file and versions made from the old join show as
      // out of date; a version pinned as final was made from the old clips, so the pin goes too.
      const fresh = store.get(p.id) || p;
      const fep = fresh.episodes.find(e => e.id === ep.id) || ep;
      fep.exportPath = outFile;
      fep.outputs = upsertOutput(fep.outputs, "joined", outFile);
      if (fep.finalKind && fep.finalKind !== "joined") fep.finalKind = undefined;
      store.save(fresh);
      const warnings = joinWarnings(ordered);
      for (const w of warnings) emit(p.id, { type: "ffmpeg", text: `warning: ${w}` });
      emit(p.id, { type: "stitched", episodeId: ep.id, file: outFile });
      res.json({ file: outFile, warnings });
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
          kind: refKindInfo(String(r.kind || prior?.kind || ""))?.id,
          person: String(r.person || prior?.person || "").trim().slice(0, 60) || undefined,
          skip: typeof r.skip === "boolean" ? r.skip : prior?.skip,
          prompt: String(r.prompt || ""),
          negative: String(r.negative || ""),
          seed: Number(r.seed) || Math.floor(Math.random() * 100000),
          fromRefIds: prior?.fromRefIds,
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
        group: String(raw.group || old?.group || "").trim() || undefined,
        refs,
        exportPath: old?.exportPath || null,
        scenes: (Array.isArray(raw.scenes) ? raw.scenes : []).map((s: Json, j: number): Scene => {
          const sceneNumber = Number(s.number) || j + 1;
          const prior = old?.scenes.find(x => x.number === sceneNumber);
          const refIds = (Array.isArray(s.refs) ? s.refs : [])
            .map((name: string) => refs.find(r => r.name === name)?.id)
            .filter(Boolean) as string[];
          const lines = importLines(s.lines);
          return {
            id: prior?.id || newId(),
            number: sceneNumber,
            vo: String(s.vo || "") || joinLines(lines),
            lines: lines.length ? lines : undefined,
            shot: String(s.shot || ""),
            textCard: String(s.textCard || ""),
            refIds: refIds.length ? refIds : refs.filter(r => r.role === "style").map(r => r.id),
            cast: Array.isArray(s.cast) ? s.cast.map((n: unknown) => String(n).trim()).filter(Boolean) : prior?.cast,
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
