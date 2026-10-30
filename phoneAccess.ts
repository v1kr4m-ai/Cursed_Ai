/**
 * Phone and other-device access. The server listens on every network interface so a phone on the same Wi-Fi can open the
 * studio, which also means anyone on that network could. This puts an access code in front of every request that does
 * not come from this PC itself: the phone enters the code once (or the Android app sends it) and gets a cookie.
 *
 * Requests from this PC are never asked for a code. Phone access can be switched off completely, and the code replaced.
 */
import crypto from "crypto";
import os from "os";
import express from "express";

export interface PhoneConfig { enabled?: boolean; code?: string }

export const isLoopback = (addr?: string) => !addr || addr === "::1" || addr === "127.0.0.1" || addr === "::ffff:127.0.0.1";

/** A six-digit code: easy to type on a phone, one in a million to guess, and guesses are slowed down below. */
export const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** What the cookie holds: not the code itself, so a copied cookie value reveals nothing, and a new code ends every old login. */
export const tokenFor = (code: string) => crypto.createHash("sha256").update(`cursed-phone:${code}`).digest("hex").slice(0, 40);

export function cookieValue(header: string | undefined, name: string): string {
  for (const part of (header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

export type Decision = "allow" | "off" | "needs-code";

/** Whether a request may go on: this PC always; others only with phone access on and the right cookie, header or code. */
export function decide(input: { ip?: string; enabled: boolean; code: string; cookie?: string; header?: string; query?: string }): Decision {
  if (isLoopback(input.ip)) return "allow";
  if (!input.enabled) return "off";
  const ok = (given?: string) => !!given && given === input.code;
  if ((input.cookie && input.cookie === tokenFor(input.code)) || ok(input.header) || ok(input.query)) return "allow";
  return "needs-code";
}

/** The addresses a phone can use to reach this PC. */
export function lanAddresses(port: number, scheme = "http"): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push(`${scheme}://${n.address}:${port}`);
  return out;
}

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cursed_Ai</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e10;color:#e4e4e7;font:16px system-ui,sans-serif}main{width:min(92vw,22rem);padding:1.5rem;border:1px solid #27272a;border-radius:1.25rem;background:#18181b}
h1{font-size:1.1rem;margin:0 0 .4rem}p{color:#a1a1aa;font-size:.85rem;line-height:1.45}input{width:100%;box-sizing:border-box;margin:.6rem 0;padding:.75rem;border-radius:.75rem;border:1px solid #3f3f46;background:#09090b;color:#fff;font-size:1.4rem;letter-spacing:.4rem;text-align:center}
button{width:100%;padding:.75rem;border:0;border-radius:.75rem;background:#7c3aed;color:#fff;font-weight:700;font-size:1rem}</style></head><body><main>${body}</main></body></html>`;

const loginPage = (error = "") => page(`<h1>Cursed_Ai</h1><p>Enter the access code shown on the PC in <b>Settings &gt; General &gt; Phone &amp; other devices</b>.</p>${error ? `<p style="color:#fca5a5">${error}</p>` : ""}
<form method="post" action="/__phone-login"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" autofocus><button>Open the studio</button></form>`);
const offPage = page(`<h1>Phone access is off</h1><p>The PC has switched off access from other devices. Turn it on in <b>Settings &gt; General &gt; Phone &amp; other devices</b> on the PC.</p>`);

export function registerPhoneAccess(app: express.Express, opts: { get: () => PhoneConfig; set: (c: PhoneConfig) => void; port: number; httpsPort?: number }) {
  const cfg = () => {
    const c = opts.get();
    if (!c.code) opts.set({ ...c, code: newCode() });
    const now = opts.get();
    return { enabled: now.enabled !== false, code: now.code as string };
  };
  // Wrong guesses are slowed: five misses from one address lock it out for a minute.
  const misses = new Map<string, { n: number; until: number }>();
  const locked = (ip: string) => (misses.get(ip)?.until || 0) > Date.now();
  const miss = (ip: string) => { const m = misses.get(ip) || { n: 0, until: 0 }; m.n++; if (m.n >= 5) { m.until = Date.now() + 60_000; m.n = 0; } misses.set(ip, m); };
  const cookie = (code: string) => `cursed_phone=${tokenFor(code)}; Max-Age=${30 * 24 * 3600}; Path=/; HttpOnly; SameSite=Lax`;
  const urlencoded = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.method !== "POST") return next();
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on("end", () => { (req as any).form = Object.fromEntries(new URLSearchParams(body)); next(); });
  };

  /** The gate: everything below it is behind the code for requests from other devices. */
  app.use((req, res, next) => {
    const ip = req.socket.remoteAddress;
    const { enabled, code } = cfg();
    if (isLoopback(ip)) return next();
    if (!enabled) return res.status(403).send(offPage);
    if (req.path === "/__phone-login") return next();
    const d = decide({ ip, enabled, code, cookie: cookieValue(req.headers.cookie, "cursed_phone"), header: String(req.headers["x-cursed-code"] || "") });
    if (d === "allow") return next();
    if (req.path.startsWith("/api")) return res.status(401).json({ error: "An access code is needed. Open the studio in a browser on this device and enter the code from the PC." });
    return res.status(401).send(loginPage());
  });

  // Sign in: a form post from the page, or a GET with ?code= from the Android app (both set the cookie and go to the studio).
  app.all("/__phone-login", urlencoded, (req, res) => {
    const ip = req.socket.remoteAddress || "";
    const { enabled, code } = cfg();
    if (!enabled && !isLoopback(ip)) return res.status(403).send(offPage);
    const given = String((req as any).form?.code ?? req.query.code ?? "").trim();
    if (locked(ip)) return res.status(429).send(loginPage("Too many wrong codes. Wait a minute and try again."));
    if (!given) return res.status(200).send(loginPage());
    if (given !== code) { miss(ip); return res.status(401).send(loginPage("That code is not right.")); }
    res.setHeader("Set-Cookie", cookie(code));
    res.redirect("/");
  });

  const local = (req: express.Request, res: express.Response) => { if (isLoopback(req.socket.remoteAddress)) return true; res.status(403).json({ error: "Only this PC can change phone access." }); return false; };

  app.get("/api/phone/info", (req, res) => {
    if (!local(req, res)) return;
    const { enabled, code } = cfg();
    const ports = [opts.port, opts.httpsPort].filter(Boolean).join(",");
    res.json({ enabled, code, port: opts.port, addresses: lanAddresses(opts.port), secureAddresses: opts.httpsPort ? lanAddresses(opts.httpsPort, "https") : [], firewall: `netsh advfirewall firewall add rule name="Cursed_Ai phone" dir=in action=allow protocol=TCP localport=${ports} profile=private` });
  });

  app.post("/api/phone/config", express.json(), (req, res) => {
    if (!local(req, res)) return;
    const cur = opts.get();
    const next: PhoneConfig = { ...cur };
    if (typeof req.body?.enabled === "boolean") next.enabled = req.body.enabled;
    if (req.body?.newCode) next.code = newCode();
    opts.set(next);
    const { enabled, code } = cfg();
    res.json({ enabled, code, port: opts.port, addresses: lanAddresses(opts.port) });
  });
}
