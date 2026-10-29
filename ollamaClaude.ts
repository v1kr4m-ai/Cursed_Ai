/**
 * "Ollama_Claude": runs the real Claude Code CLI against local (or Ollama-cloud) models.
 *
 * Ollama speaks the Anthropic Messages API, so Claude Code only needs ANTHROPIC_BASE_URL pointing at it (this is what `ollama launch claude`
 * does). Each message is one headless run (`claude -p`, prompt on stdin, `--output-format stream-json`); follow-ups use `--resume <session>`.
 * The JSON events are relayed to the browser as server-sent events, so the page can show text, thinking and tool calls as they happen.
 */
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, execFile, type ChildProcess } from "child_process";
import { registerOllamaRestart } from "./ollamaRestart";
import { listFolders, listSessions, readSession } from "./oclaudeHistory";

export interface OllamaClaudeOptions { ollamaUrl: string }

export interface ModelInfo {
  name: string;
  compatible: boolean;
  /** Why it is (not) compatible, in plain words. */
  reason: string;
  tools: boolean;
  thinking: boolean;
  vision: boolean;
  cloud: boolean;
  contextLength: number | null;
  sizeBytes: number | null;
  params: string;
}

const homeDir = os.homedir();
export const WORKSPACE = path.join(homeDir, "OllamaClaude");

function findClaude(): Promise<string | null> {
  return new Promise(resolve => {
    execFile(process.platform === "win32" ? "where" : "which", ["claude"], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null);
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      resolve(lines.find(l => /\.exe$/i.test(l)) || lines[0] || null);
    });
  });
}

function claudeVersion(file: string): Promise<string> {
  return new Promise(resolve => {
    execFile(file, ["--version"], { windowsHide: true, timeout: 10000 }, (_e, out) => resolve((out || "").trim()));
  });
}

/** Stops a process and everything it started (Claude's tools run shells). */
function killTree(proc: ChildProcess) {
  if (!proc.pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else { try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch { /* gone */ } } }
}

/** Names of the markdown files / skill folders in a .claude directory. */
function scanNames(dir: string, kind: "commands" | "skills"): string[] {
  try {
    const out: string[] = [];
    const root = path.join(dir, kind);
    const walk = (d: string, prefix: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (kind === "commands") {
          if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + ":");
          else if (/\.md$/i.test(e.name)) out.push(prefix + e.name.replace(/\.md$/i, ""));
        } else if (e.isDirectory() && fs.existsSync(path.join(d, e.name, "SKILL.md"))) out.push(e.name);
      }
    };
    walk(root, "");
    return out;
  } catch { return []; }
}

export function registerOllamaClaude(app: express.Express, opts: OllamaClaudeOptions) {
  const modelCache = new Map<string, { at: number; info: ModelInfo }>();
  const runs = new Map<string, ChildProcess>();

  async function describe(name: string, size: number | null): Promise<ModelInfo> {
    const hit = modelCache.get(name);
    if (hit && Date.now() - hit.at < 10 * 60_000) return { ...hit.info, sizeBytes: size };
    const cloud = /[:-]cloud$/i.test(name);
    let caps: string[] = [], ctx: number | null = null, params = "";
    try {
      const r = await fetch(`${opts.ollamaUrl}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d: any = await r.json();
        caps = Array.isArray(d.capabilities) ? d.capabilities : [];
        const mi = d.model_info || {};
        const key = Object.keys(mi).find(k => /\.context_length$/.test(k));
        ctx = key ? Number(mi[key]) || null : null;
        params = d.details?.parameter_size || "";
      }
    } catch { /* offline or a cloud model that is not reachable: judged by name below */ }
    // Claude Code works through tool calls, so a model without the "tools" capability cannot drive it.
    const tools = caps.includes("tools") || (!caps.length && cloud);
    const info: ModelInfo = {
      name, tools, cloud, thinking: caps.includes("thinking"), vision: caps.includes("vision"), contextLength: ctx, sizeBytes: size, params,
      compatible: tools && !caps.includes("embedding"),
      reason: caps.includes("embedding") ? "An embedding model - it cannot chat."
        : tools ? (cloud ? "Runs in Ollama's cloud (needs internet)." : "Supports tool calls, which Claude Code needs.")
        : caps.length ? "No tool-call support, so Claude Code cannot use it." : "Could not read its capabilities.",
    };
    modelCache.set(name, { at: Date.now(), info });
    return info;
  }

  /** Is Claude Code installed, is Ollama up, and which installed models can drive Claude Code. */
  app.get("/api/oclaude/status", async (req, res) => {
    const file = await findClaude();
    const version = file ? await claudeVersion(file) : "";
    let running = false, ollamaVersion = "", models: ModelInfo[] = [];
    try {
      const r = await fetch(`${opts.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        running = true;
        const tags: any = await r.json();
        const list: { name: string; size: number }[] = (tags.models || []).map((m: any) => ({ name: m.name, size: m.size || null }));
        models = await Promise.all(list.map(m => describe(m.name, m.size)));
        try { ollamaVersion = (await (await fetch(`${opts.ollamaUrl}/api/version`, { signal: AbortSignal.timeout(1500) })).json() as any).version || ""; } catch { /* optional */ }
      }
    } catch { /* ollama is not running */ }
    let loaded: { name: string; contextLength: number | null }[] = [];
    if (running) {
      try {
        const ps: any = await (await fetch(`${opts.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(1500) })).json();
        loaded = (ps.models || []).map((m: any) => ({ name: m.name, contextLength: m.context_length ?? null }));
      } catch { /* optional */ }
    }
    res.json({ claude: { found: !!file, path: file, version }, ollama: { running, version: ollamaVersion, url: opts.ollamaUrl }, models: models.sort((a, b) => Number(b.compatible) - Number(a.compatible) || Number(a.cloud) - Number(b.cloud) || a.name.localeCompare(b.name)), loaded, workspace: WORKSPACE });
  });

  /** Slash commands, skills and MCP servers that can be dropped into the prompt. */
  app.get("/api/oclaude/commands", (req, res) => {
    const cwd = String(req.query.cwd || "");
    const dirs = [path.join(homeDir, ".claude"), ...(cwd && fs.existsSync(cwd) ? [path.join(cwd, ".claude")] : [])];
    const commands = [...new Set(dirs.flatMap(d => scanNames(d, "commands")))].sort();
    const skills = [...new Set(dirs.flatMap(d => scanNames(d, "skills")))].sort();
    res.json({ commands, skills });
  });

  app.get("/api/oclaude/mcp", async (req, res) => {
    const file = await findClaude();
    if (!file) return res.json({ servers: [], error: "Claude Code is not installed." });
    const cwd = String(req.query.cwd || "");
    execFile(file, ["mcp", "list"], { windowsHide: true, timeout: 25000, cwd: cwd && fs.existsSync(cwd) ? cwd : WORKSPACE }, (_e, out) => {
      const servers = (out || "").split(/\r?\n/).map(l => l.trim()).filter(l => /^[^\s:]+:\s/.test(l) && !/^checking/i.test(l)).map(l => {
        const m = /^([^:]+):\s*(.*?)(?:\s+-\s+(.*))?$/.exec(l);
        return { name: m?.[1] || l, target: m?.[2] || "", status: m?.[3] || "" };
      });
      res.json({ servers });
    });
  });

  /** One Claude Code run: prompt in, a stream of events out. */
  app.post("/api/oclaude/run", async (req, res) => {
    const b = req.body || {};
    const prompt = String(b.prompt || "").trim();
    const model = String(b.model || "").trim();
    if (!prompt) return res.status(400).json({ error: "Write something first." });
    if (!model) return res.status(400).json({ error: "Pick a model." });
    const file = await findClaude();
    if (!file) return res.status(400).json({ error: "Claude Code is not installed (it was not found on PATH)." });

    let cwd = String(b.cwd || "").trim() || WORKSPACE;
    try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* checked next */ }
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return res.status(400).json({ error: `The working folder does not exist: ${cwd}` });

    const permission = ["plan", "default", "acceptEdits", "bypassPermissions"].includes(b.permission) ? b.permission : "acceptEdits";
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model, "--permission-mode", permission];
    if (typeof b.sessionId === "string" && /^[0-9a-f-]{20,}$/i.test(b.sessionId)) args.push("--resume", b.sessionId, ...(b.fork ? ["--fork-session"] : []));
    const allowed = Array.isArray(b.allowedTools) ? b.allowedTools.map(String).filter(Boolean) : [];
    if (allowed.length) args.push("--allowedTools", allowed.join(","));
    for (const d of Array.isArray(b.addDirs) ? b.addDirs : []) if (typeof d === "string" && fs.existsSync(d)) args.push("--add-dir", d);
    if (Number(b.maxTurns) > 0) args.push("--max-turns", String(Math.min(200, Math.round(Number(b.maxTurns)))));
    // Smaller models guess the home folder for "a file called x" unless told where they are, and the write is then refused.
    const where = `Your working directory is ${cwd}. Create and edit files inside it: use relative paths such as "hello.txt" or paths that start with this folder. Never write to the home folder or anywhere outside the working directory.`;
    args.push("--append-system-prompt", [where, typeof b.appendSystemPrompt === "string" ? b.appendSystemPrompt.trim() : ""].filter(Boolean).join(" "));
    // Your own Claude settings add hooks and a long skill list - tens of thousands of tokens, which small local models cannot digest. Off unless asked for.
    if (b.userSettings !== true) args.push("--setting-sources", "project");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: opts.ollamaUrl,
      ANTHROPIC_AUTH_TOKEN: "ollama",
      ANTHROPIC_API_KEY: "",
      // Claude Code also calls "small/fast" and subagent models; point every role at the chosen model so nothing asks Ollama for a Claude name.
      ANTHROPIC_MODEL: model, ANTHROPIC_SMALL_FAST_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL: model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1",
    };

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (o: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
    const runId = Math.random().toString(36).slice(2, 10);
    const proc = spawn(file, args, { cwd, env, windowsHide: true });
    runs.set(runId, proc);
    send({ type: "cursed_run", runId, cwd, model, permission, args: args.filter(a => a !== prompt) });

    let buf = "";
    const line = (l: string) => {
      const t = l.trim();
      if (!t) return;
      try {
        const ev = JSON.parse(t);
        // Hook chatter from the user's own Claude settings is noise here.
        if (ev?.type === "system" && /^hook_/.test(ev.subtype || "")) return;
        send(ev);
      } catch { send({ type: "cursed_stdout", text: t }); }
    };
    proc.stdout.on("data", (c: Buffer) => { buf += c.toString(); const parts = buf.split("\n"); buf = parts.pop() || ""; parts.forEach(line); });
    let errTail = "";
    proc.stderr.on("data", (c: Buffer) => { const t = c.toString(); errTail = (errTail + t).slice(-2000); send({ type: "cursed_stderr", text: t }); });
    proc.on("error", e => send({ type: "cursed_error", text: `Could not start Claude Code: ${e.message}` }));
    proc.on("close", code => {
      if (buf.trim()) line(buf);
      runs.delete(runId);
      send({ type: "cursed_exit", code, stderr: code ? errTail.trim().slice(-600) : "" });
      res.end();
    });
    res.on("close", () => { if (runs.has(runId)) killTree(proc); });
    proc.stdin.on("error", () => { /* the process ended before reading */ });
    proc.stdin.end(prompt);
  });

  /** Puts a file back as it was before Claude touched it. Only inside the working folder or a folder added to the session. */
  app.post("/api/oclaude/undo", (req, res) => {
    const b = req.body || {};
    const cwd = typeof b.cwd === "string" ? b.cwd : "";
    if (!cwd || typeof b.path !== "string" || !(b.before === null || typeof b.before === "string")) return res.status(400).json({ error: "Bad request" });
    const target = path.resolve(cwd, b.path);
    const roots = [cwd, ...(Array.isArray(b.addDirs) ? b.addDirs : [])].filter((d): d is string => typeof d === "string" && !!d).map(d => path.resolve(d));
    if (!roots.some(r => target === r || target.startsWith(r + path.sep))) return res.status(403).json({ error: "That file is outside the session's folders." });
    try {
      if (b.before === null) fs.rmSync(target, { force: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, b.before, "utf8"); }
      res.json({ ok: true, path: target });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** A file dropped on the message box: saved in <folder>/attachments/ so Claude can open it, and named back as a path relative to the folder. */
  app.post("/api/oclaude/drop", express.raw({ type: "*/*", limit: "200mb" }), (req, res) => {
    const cwd = String(req.query.cwd || "");
    const name = path.basename(String(req.query.name || "")).replace(/[^A-Za-z0-9 ._()-]+/g, "_").slice(0, 120);
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return res.status(400).json({ error: "Choose the session's folder first." });
    if (!name || name.startsWith(".")) return res.status(400).json({ error: "That file has no usable name." });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Nothing was received." });
    try {
      const dir = path.join(cwd, "attachments");
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(name), stem = path.basename(name, ext);
      let file = path.join(dir, name);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stem} (${n})${ext}`);
      fs.writeFileSync(file, req.body);
      res.json({ ok: true, path: path.relative(cwd, file).replace(/\\/g, "/") });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** Branch and uncommitted change size of the session folder, for the side panel. Not a repository: { repo: false }. */
  app.get("/api/oclaude/git", (req, res) => {
    const cwd = String(req.query.cwd || "");
    if (!cwd || !fs.existsSync(cwd)) return res.json({ repo: false });
    const git = (args: string[]) => new Promise<string | null>(ok => execFile("git", ["-C", cwd, ...args], { timeout: 6000, windowsHide: true }, (e, out) => ok(e ? null : String(out))));
    (async () => {
      const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
      if (!branch) return res.json({ repo: false });
      const stat = (await git(["diff", "--shortstat", "HEAD"])) || "";
      const num = (re: RegExp) => Number(re.exec(stat)?.[1] || 0);
      const untracked = ((await git(["ls-files", "--others", "--exclude-standard"])) || "").split(/\r?\n/).filter(Boolean).length;
      res.json({ repo: true, branch, files: num(/(\d+) files? changed/), added: num(/(\d+) insertions?/), removed: num(/(\d+) deletions?/), untracked });
    })().catch(e => res.json({ repo: false, error: String(e) }));
  });

  /** Claude Code's own earlier sessions in a folder (from this app, the terminal or the desktop app), newest first. */
  app.get("/api/oclaude/history", (req, res) => {
    const cwd = String(req.query.cwd || "");
    if (!cwd) return res.json({ sessions: [] });
    res.json({ sessions: listSessions(cwd) });
  });
  /** Every folder with Claude Code sessions, for the folder tree. */
  app.get("/api/oclaude/folders", (_req, res) => res.json({ folders: listFolders() }));
  app.get("/api/oclaude/history/:id", (req, res) => {
    const items = readSession(String(req.query.cwd || ""), req.params.id);
    if (!items) return res.status(404).json({ error: "That session was not found in this folder." });
    res.json({ items });
  });

  registerOllamaRestart(app, { ollamaUrl: opts.ollamaUrl });

  app.post("/api/oclaude/stop", (req, res) => {
    const proc = runs.get(String(req.body?.runId || ""));
    if (proc) killTree(proc);
    res.json({ ok: !!proc });
  });
}
