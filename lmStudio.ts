import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import type { Express } from "express";

/** Start / status for LM Studio, like the ComfyUI start button: launches its local server so its models show up under Models. */
export function registerLmStudio(app: Express, opts: { url: string; getPath: () => string | undefined; setPath: (p: string) => void }) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const local = process.env.LOCALAPPDATA || "";
  const defaults = [
    path.join(local, "Programs", "LM Studio", "LM Studio.exe"),
    path.join(local, "LM-Studio", "LM Studio.exe"),
    "C:\\Program Files\\LM Studio\\LM Studio.exe",
  ];
  const lmsCli = path.join(home, ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms");

  const exe = (): string | null => {
    const chosen = opts.getPath();
    if (chosen && fs.existsSync(chosen)) {
      if (fs.statSync(chosen).isFile()) return chosen;
      const inside = path.join(chosen, "LM Studio.exe");
      if (fs.existsSync(inside)) return inside;
    }
    return defaults.find(p => p && fs.existsSync(p)) || null;
  };
  const running = async () => {
    try { return (await fetch(`${opts.url}/v1/models`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
  };
  let starting: Promise<void> | null = null;

  app.get("/api/lmstudio/status", async (_req, res) => {
    res.json({ running: await running(), starting: !!starting, path: exe(), chosen: opts.getPath() || null, hasCli: fs.existsSync(lmsCli) });
  });

  app.post("/api/lmstudio/config", (req, res) => {
    const p = req.body?.path;
    if (typeof p !== "string" || !fs.existsSync(p)) return res.status(400).json({ error: "That path does not exist." });
    opts.setPath(p);
    if (!exe()) return res.status(400).json({ error: "No LM Studio.exe found there." });
    res.json({ path: exe() });
  });

  app.post("/api/lmstudio/start", async (_req, res) => {
    if (await running()) return res.json({ running: true, alreadyRunning: true });
    const target = exe();
    if (!target && !fs.existsSync(lmsCli)) return res.status(404).json({ error: "LM Studio was not found. Choose its LM Studio.exe in Settings > Integrations." });
    try {
      if (!starting) {
        starting = (async () => {
          // The CLI starts only the local server (no window); the app itself is the fallback.
          if (fs.existsSync(lmsCli)) {
            spawn(lmsCli, ["server", "start"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
            for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 1500)); if (await running()) return; }
          }
          if (target) spawn(target, [], { detached: true, stdio: "ignore" }).unref();
          for (let i = 0; i < 40; i++) { // the app opens first; its server may need switching on once (Developer tab)
            await new Promise(r => setTimeout(r, 2000));
            if (await running()) return;
          }
          throw new Error("LM Studio opened but its local server is not on. In LM Studio open the Developer tab and switch the server on.");
        })().finally(() => { starting = null; });
      }
      await starting;
      res.json({ running: true, alreadyRunning: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
