/**
 * ComfyUI's own console, shown in the app's Console page. ComfyUI keeps its recent log and serves it at /internal/logs/raw
 * (the same feed its own Logs panel reads), so this works however ComfyUI was started, by this app or by hand.
 *
 * The page asks for what is new since the last line it has: GET /api/comfyui/logs?since=<time of the last entry>.
 */
import type express from "express";
import { execFile } from "child_process";
import { listeningPids } from "./comfyLaunch";

export interface LogEntry { t: string; m: string }

/** The entries after `since`. If `since` is newer than anything ComfyUI has (it restarted), everything is returned again. */
export function entriesSince(entries: LogEntry[], since: string): { entries: LogEntry[]; next: string; restarted: boolean } {
  const last = entries.length ? entries[entries.length - 1].t : since;
  if (!since) return { entries, next: last, restarted: false };
  if (entries.length && since > last) return { entries, next: last, restarted: true };
  return { entries: entries.filter(e => e.t > since), next: last > since ? last : since, restarted: false };
}

export function registerComfyLogs(app: express.Express, opts: { comfyUrl: () => string; startupLog?: () => string[] }) {
  app.get("/api/comfyui/logs", async (req, res) => {
    const since = String(req.query.since || "");
    try {
      const r = await fetch(`${opts.comfyUrl()}/internal/logs/raw`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return res.json({ up: true, supported: false, entries: [], next: since, restarted: false, startup: opts.startupLog?.() || [] });
      const body: any = await r.json();
      const entries: LogEntry[] = Array.isArray(body?.entries) ? body.entries.filter((e: any) => e && typeof e.t === "string" && typeof e.m === "string") : [];
      res.json({ up: true, supported: true, ...entriesSince(entries, since) });
    } catch {
      // Not answering (starting, stopped or crashed): what ComfyUI wrote to its console file the last time the app started it.
      res.json({ up: false, supported: true, entries: [], next: since, restarted: false, startup: opts.startupLog?.() || [] });
    }
  });

  /**
   * Stop ComfyUI, however it was started (by this app or its own shortcut), so its GPU memory goes back to the
   * offline language models: whatever listens on ComfyUI's port is ended, with its child processes.
   */
  app.post("/api/comfyui/stop", async (_req, res) => {
    if (process.platform !== "win32") return res.status(501).json({ error: "Stopping ComfyUI from here works on Windows only." });
    const port = Number(new URL(opts.comfyUrl()).port || 8188);
    const run = (cmd: string, args: string[]) => new Promise<string>(ok => execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (_e, out) => ok(String(out || ""))));
    const pids = listeningPids(await run("netstat", ["-ano", "-p", "tcp"]), port);
    if (!pids.length) return res.json({ ok: true, wasRunning: false });
    for (const pid of pids) await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    res.json({ ok: true, wasRunning: true, stopped: pids });
  });

  /** Keep ComfyUI running but let go of the models it holds in GPU memory (ComfyUI's own /free). */
  app.post("/api/comfyui/free", async (_req, res) => {
    try {
      const r = await fetch(`${opts.comfyUrl()}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) return res.status(502).json({ error: `ComfyUI answered ${r.status}` });
      res.json({ ok: true });
    } catch { res.status(503).json({ error: "ComfyUI is not running." }); }
  });
}
