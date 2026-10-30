/**
 * A second, HTTPS address for phones on the home network. Phone browsers only allow the microphone (and some other
 * features) on a secure page; plain http://192.168.x.x is not one. The certificate is made once by Windows itself
 * (New-SelfSignedCertificate) for this PC's network addresses and kept in ./https until it nears its end (800 days),
 * even if the addresses change: the Android app remembers it, and a new one would look like a different PC.
 * Being self-made, a phone browser warns once ("not private") and the person accepts it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import crypto from "crypto";
import { spawnSync } from "child_process";
import type express from "express";

export const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

/** The names the certificate must cover: this PC's network addresses, localhost and the PC's name. */
export function certNames(): string[] {
  const ips = Object.values(os.networkInterfaces()).flatMap(l => l || []).filter(n => n.family === "IPv4" && !n.internal).map(n => n.address);
  return [...new Set(["localhost", os.hostname(), "127.0.0.1", ...ips])];
}

const isIp = (n: string) => /^\d+\.\d+\.\d+\.\d+$/.test(n);

/** The PowerShell that makes the certificate and saves it as a password-protected .pfx (paths and password come in through the environment). */
export function certScript(names: string[]): string {
  const san = names.map(n => (isIp(n) ? `IPAddress=${n}` : `DNS=${n}`)).join("&");
  return [
    `$c = New-SelfSignedCertificate -Subject 'CN=Cursed_Ai on ${os.hostname().replace(/'/g, "")}' -TextExtension @('2.5.29.17={text}${san}') -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(800) -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048`,
    "$p = ConvertTo-SecureString -String $env:PFX_PASS -Force -AsPlainText",
    "try { Export-PfxCertificate -Cert $c -FilePath $env:PFX_OUT -Password $p -CryptoAlgorithmOption AES256_SHA256 | Out-Null } catch { Export-PfxCertificate -Cert $c -FilePath $env:PFX_OUT -Password $p | Out-Null }",
    "Remove-Item ('Cert:\\CurrentUser\\My\\' + $c.Thumbprint)",
  ].join("; ");
}

interface Meta { names: string[]; pass: string; made?: number }
const LIFE_MS = 780 * 24 * 3600 * 1000;

/** The certificate for the current addresses, made (or made again) when needed. Null when it cannot be made here. */
export function ensureCert(dir: string): { pfx: Buffer; passphrase: string } | null {
  if (process.platform !== "win32") return null;
  const pfxFile = path.join(dir, "cert.pfx"), metaFile = path.join(dir, "cert.json");
  const names = certNames();
  try {
    const meta: Meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (fs.existsSync(pfxFile) && Date.now() - (meta.made || 0) < LIFE_MS) return { pfx: fs.readFileSync(pfxFile), passphrase: meta.pass };
  } catch { /* no certificate yet */ }
  fs.mkdirSync(dir, { recursive: true });
  const pass = crypto.randomBytes(18).toString("base64url");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", certScript(names)], { env: { ...process.env, PFX_PASS: pass, PFX_OUT: pfxFile }, windowsHide: true, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0 || !fs.existsSync(pfxFile)) { console.log("[HTTPS] Could not make a certificate: " + (r.stderr || r.error?.message || "").trim().slice(0, 300)); return null; }
  fs.writeFileSync(metaFile, JSON.stringify({ names, pass, made: Date.now() } satisfies Meta));
  return { pfx: fs.readFileSync(pfxFile), passphrase: pass };
}

/** Serves the same app over HTTPS on HTTPS_PORT. Failing here never stops the normal address from working. */
export function listenHttps(app: express.Express, dir: string): boolean {
  const cert = ensureCert(dir);
  if (!cert) return false;
  try {
    const server = https.createServer({ pfx: cert.pfx, passphrase: cert.passphrase }, app);
    server.on("error", (e: any) => console.log(`[HTTPS] Not available on port ${HTTPS_PORT}: ${e?.message || e}`));
    server.listen(HTTPS_PORT, "0.0.0.0", () => console.log(`Secure address for phones: https://<this PC's address>:${HTTPS_PORT}`));
    return true;
  } catch (e: any) { console.log("[HTTPS] " + (e?.message || e)); return false; }
}
