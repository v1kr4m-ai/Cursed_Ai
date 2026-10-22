/**
 * Restart Ollama with a bigger context window. Ollama reads OLLAMA_CONTEXT_LENGTH when it starts, and Claude Code
 * needs 16k+ tokens just for its own instructions, so a model loaded with the default window cuts answers off.
 *
 * The restart stops Ollama (anything it has loaded or is answering is dropped), saves the setting for the user so
 * later starts keep it, and starts `ollama serve` again with it. The page asks the person to confirm first; a dry run
 * reports the steps without doing any of them.
 */
import type express from "express";
import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";

export const MIN_CONTEXT = 4096;
export const MAX_CONTEXT = 262144;

/** A whole number of tokens inside the range Ollama accepts, or null. */
export function validContext(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= MIN_CONTEXT && n <= MAX_CONTEXT ? n : null;
}

/** Where Ollama is usually installed on Windows, then the bare name for the PATH. */
export function ollamaExeCandidates(env: NodeJS.ProcessEnv): string[] {
  const list: string[] = [];
  if (env.LOCALAPPDATA) list.push(path.join(env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"));
  for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"]]) if (base) list.push(path.join(base, "Ollama", "ollama.exe"));
  list.push("ollama");
  return list;
}

export interface RestartStep { what: string; command: string }

/** What a restart does, in order; also what the dry run reports. */
export function restartSteps(contextLength: number, exe: string): RestartStep[] {
  return [
    { what: "Stop the Ollama tray app", command: 'taskkill /F /IM "ollama app.exe"' },
    { what: "Stop the Ollama server and its model runners", command: "taskkill /F /T /IM ollama.exe" },
    { what: "Save the setting for your Windows user, so later starts keep it", command: `setx OLLAMA_CONTEXT_LENGTH ${contextLength}` },
    { what: "Start Ollama again with the bigger window", command: `${exe} serve   (OLLAMA_CONTEXT_LENGTH=${contextLength})` },
  ];
}

const run = (file: string, args: string[]) => new Promise<void>(resolve => execFile(file, args, { windowsHide: true, timeout: 15000 }, () => resolve()));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function registerOllamaRestart(app: express.Express, opts: { ollamaUrl: string }) {
  app.post("/api/oclaude/ollama-context", async (req, res) => {
    const n = validContext(req.body?.contextLength);
    if (n === null) return res.status(400).json({ error: `Pick a context size between ${MIN_CONTEXT} and ${MAX_CONTEXT} tokens.` });
    if (process.platform !== "win32") return res.status(400).json({ error: "This button works on Windows only. Set OLLAMA_CONTEXT_LENGTH yourself and restart Ollama." });
    const exe = ollamaExeCandidates(process.env).find(c => c === "ollama" || fs.existsSync(c)) || "ollama";
    const steps = restartSteps(n, exe);
    if (req.body?.dryRun) return res.json({ ok: true, dryRun: true, contextLength: n, steps });

    try {
      await run("taskkill", ["/F", "/IM", "ollama app.exe"]);
      await run("taskkill", ["/F", "/T", "/IM", "ollama.exe"]);
      await run("setx", ["OLLAMA_CONTEXT_LENGTH", String(n)]);
      await sleep(1200);
      const child = spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, OLLAMA_CONTEXT_LENGTH: String(n) } });
      child.on("error", () => { /* reported below when the server never answers */ });
      child.unref();
      let version = "";
      for (let i = 0; i < 25 && !version; i++) {
        await sleep(1000);
        try { version = ((await (await fetch(`${opts.ollamaUrl}/api/version`, { signal: AbortSignal.timeout(1500) })).json()) as any).version || ""; } catch { /* still starting */ }
      }
      if (!version) return res.status(500).json({ error: "Ollama did not come back within 25 seconds. Start it from the Start menu; the setting is saved." });
      res.json({ ok: true, contextLength: n, version, steps });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
