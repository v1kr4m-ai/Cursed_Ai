/**
 * Google Drive / Sheets / Docs for the prompt box and for saving results.
 *
 * - Reading: a Drive file picker (private files, through the person's own Google sign-in) and pasted links (files shared
 *   "anyone with the link" need no sign-in at all). Sheets, Docs and Slides are exported as xlsx / docx / pptx and then
 *   read like any local file.
 * - Writing: every result can be uploaded to a Drive folder automatically.
 * - Sign-in is the standard installed-app flow (loopback redirect, PKCE) with the person's OWN OAuth client from Google
 *   Cloud Console - nothing is shared with anyone else and the app has no Google credentials of its own.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
// drive.readonly: pick any file to read prompts from. drive.file: files this app creates (the uploaded results).
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"].join(" ");

interface GoogleConfig {
  clientId?: string; clientSecret?: string; refreshToken?: string; email?: string;
  autosave?: boolean; folderId?: string; folderName?: string;
}
export interface UploadResult { at: number; file: string; ok: boolean; url?: string; error?: string }

export const GOOGLE_NATIVE_TYPES: Record<string, { ext: string; mime: string }> = {
  "application/vnd.google-apps.spreadsheet": { ext: ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  "application/vnd.google-apps.document": { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  "application/vnd.google-apps.presentation": { ext: ".pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
};
const FOLDER = "application/vnd.google-apps.folder";

export function createGoogle(dir: string, redirectBase: () => string) {
  const file = path.join(dir, "google.json");
  const read = (): GoogleConfig => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
  const write = (c: GoogleConfig) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, file); };
  const pending = new Map<string, { verifier: string; at: number }>();
  let access: { token: string; exp: number } | null = null;
  let lastUpload: UploadResult | null = null;

  const redirectUri = () => `${redirectBase()}/api/google/callback`;

  async function tokenRequest(body: Record<string, string>) {
    const c = read();
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.clientId || "", client_secret: c.clientSecret || "", ...body }) });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error_description || d.error || `Google sign-in failed (HTTP ${r.status})`);
    return d;
  }

  async function accessToken(): Promise<string> {
    if (access && access.exp > Date.now() + 30_000) return access.token;
    const c = read();
    if (!c.refreshToken) throw new Error("Not connected to Google.");
    const d = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken });
    access = { token: d.access_token, exp: Date.now() + (d.expires_in || 3000) * 1000 };
    return access.token;
  }

  async function api(url: string, init: RequestInit = {}): Promise<Response> {
    const t = await accessToken();
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
    if (!r.ok) {
      const d: any = await r.clone().json().catch(() => ({}));
      throw new Error(d?.error?.message || `Google Drive error (HTTP ${r.status})`);
    }
    return r;
  }

  return {
    status() {
      const c = read();
      return { configured: !!(c.clientId && c.clientSecret), connected: !!c.refreshToken, email: c.email || "", autosave: !!c.autosave, folder: c.folderId ? { id: c.folderId, name: c.folderName || "" } : null, lastUpload, redirectUri: redirectUri() };
    },
    setClient(clientId: string, clientSecret: string) {
      // Pasted with a prefix such as "https://" or surrounding quotes? Keep just the real ID.
      const id = /[0-9]+-[a-z0-9]+.apps.googleusercontent.com/i.exec(clientId)?.[0];
      if (!id) throw new Error("That does not look like a Google client ID. It looks like 123456789-abcdef.apps.googleusercontent.com.");
      const c = read(); c.clientId = id; c.clientSecret = clientSecret.trim().replace(/^["']|["']$/g, ""); write(c);
    },
    settings(p: { autosave?: boolean; folder?: { id: string; name: string } | null }) {
      const c = read();
      if (typeof p.autosave === "boolean") c.autosave = p.autosave;
      if (p.folder === null) { delete c.folderId; delete c.folderName; } else if (p.folder) { c.folderId = p.folder.id; c.folderName = p.folder.name; }
      write(c);
    },
    disconnect() { const c = read(); delete c.refreshToken; delete c.email; write(c); access = null; },

    /** Where to send the person to sign in. */
    authUrl(): string {
      const c = read();
      if (!c.clientId || !c.clientSecret) throw new Error("Enter your Google client ID and secret first.");
      const state = crypto.randomBytes(16).toString("hex");
      const verifier = crypto.randomBytes(32).toString("base64url");
      for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
      pending.set(state, { verifier, at: Date.now() });
      const q = new URLSearchParams({
        client_id: c.clientId, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES, state,
        access_type: "offline", prompt: "consent", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
      });
      return `${AUTH_URL}?${q}`;
    },
    async handleCallback(code: string, state: string) {
      const p = pending.get(state);
      if (!p) throw new Error("This sign-in link expired - start again from the app.");
      pending.delete(state);
      const d = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: p.verifier });
      const c = read();
      if (d.refresh_token) c.refreshToken = d.refresh_token;
      access = { token: d.access_token, exp: Date.now() + (d.expires_in || 3000) * 1000 };
      try { const u: any = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${d.access_token}` } })).json(); c.email = u.email || ""; } catch { /* email is only a label */ }
      write(c);
    },

    /** One page of a folder (or search results). */
    async list(opts: { parent?: string; q?: string; pageToken?: string; foldersOnly?: boolean }) {
      const parts = ["trashed = false"];
      if (opts.q) parts.push(`name contains '${opts.q.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
      else parts.push(`'${opts.parent || "root"}' in parents`);
      if (opts.foldersOnly) parts.push(`mimeType = '${FOLDER}'`);
      const url = `${DRIVE}/files?` + new URLSearchParams({
        q: parts.join(" and "), pageSize: "50", orderBy: "folder,modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink)", ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
      });
      return (await api(url)).json() as Promise<{ files: any[]; nextPageToken?: string }>;
    },

    /** Downloads a file for reading: Google Sheets / Docs / Slides come out as xlsx / docx / pptx. */
    async download(id: string, name: string, mimeType: string): Promise<{ name: string; bytes: Buffer }> {
      const native = GOOGLE_NATIVE_TYPES[mimeType];
      const url = native ? `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(native.mime)}` : `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`;
      const r = await api(url);
      return { name: native && !name.toLowerCase().endsWith(native.ext) ? name + native.ext : name, bytes: Buffer.from(await r.arrayBuffer()) };
    },
    async meta(id: string): Promise<{ id: string; name: string; mimeType: string }> {
      return (await api(`${DRIVE}/files/${id}?fields=id,name,mimeType&supportsAllDrives=true`)).json() as any;
    },
    connected: () => !!read().refreshToken,

    async createFolder(name: string, parent?: string): Promise<{ id: string; name: string }> {
      const r = await api(`${DRIVE}/files?fields=id,name&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) });
      return r.json() as any;
    },
    /** The folder results go to; created as "Cursed_Ai" in My Drive the first time. */
    async ensureFolder(): Promise<string> {
      const c = read();
      if (c.folderId) return c.folderId;
      const found: any = await (await api(`${DRIVE}/files?` + new URLSearchParams({ q: `name = 'Cursed_Ai' and mimeType = '${FOLDER}' and 'root' in parents and trashed = false`, fields: "files(id,name)" }))).json();
      const f = found.files?.[0] || await this.createFolder("Cursed_Ai");
      c.folderId = f.id; c.folderName = f.name; write(c);
      return f.id;
    },

    /** Resumable upload (works for big videos); streams the file instead of loading it into memory. */
    async upload(localPath: string): Promise<UploadResult> {
      const base: UploadResult = { at: Date.now(), file: path.basename(localPath), ok: false };
      try {
        const folder = await this.ensureFolder();
        const size = fs.statSync(localPath).size;
        const ext = path.extname(localPath).toLowerCase();
        const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" } as Record<string, string>)[ext] || "application/octet-stream";
        const init = await api(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`, {
          method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) },
          body: JSON.stringify({ name: path.basename(localPath), parents: [folder] }),
        });
        const location = init.headers.get("location");
        if (!location) throw new Error("Google did not return an upload address.");
        const put = await fetch(location, { method: "PUT", headers: { "Content-Type": mime, "Content-Length": String(size) }, body: Readable.toWeb(fs.createReadStream(localPath)) as any, duplex: "half" } as any);
        if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);
        const d: any = await put.json().catch(() => ({}));
        lastUpload = { ...base, ok: true, url: d.webViewLink || (d.id ? `https://drive.google.com/file/d/${d.id}/view` : undefined) };
      } catch (e: any) {
        lastUpload = { ...base, error: e?.message || String(e) };
      }
      return lastUpload!;
    },
    wantsAutosave: () => { const c = read(); return !!(c.autosave && c.refreshToken); },
  };
}

/** The ID inside a Google Sheets / Docs / Slides / Drive link, and what kind of link it is. */
export function parseGoogleLink(link: string): { id: string; kind: "sheet" | "doc" | "slides" | "file" } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(spreadsheets|document|presentation|file)\/d\/([\w-]{10,})/) || u.pathname.match(/\/(drive)\/.*?\/([\w-]{10,})/);
  const id = m?.[2] || u.searchParams.get("id") || "";
  if (!id) return null;
  const kind = m?.[1] === "spreadsheets" ? "sheet" : m?.[1] === "document" ? "doc" : m?.[1] === "presentation" ? "slides" : "file";
  return { id, kind };
}

/** Public ("anyone with the link") export, no sign-in. Throws a clear message when the file is private. */
export async function fetchPublicGoogleFile(id: string, kind: "sheet" | "doc" | "slides" | "file"): Promise<{ name: string; bytes: Buffer }> {
  const url = kind === "sheet" ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`
    : kind === "doc" ? `https://docs.google.com/document/d/${id}/export?format=docx`
    : kind === "slides" ? `https://docs.google.com/presentation/d/${id}/export/pptx`
    : `https://drive.google.com/uc?export=download&id=${id}`;
  const r = await fetch(url, { redirect: "follow" });
  const type = r.headers.get("content-type") || "";
  if (!r.ok || type.includes("text/html")) throw new Error("Google would not hand that file over. Set its sharing to \"Anyone with the link\" or connect your Google account (key icon, Drive button).");
  const disp = r.headers.get("content-disposition") || "";
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp)?.[1];
  const ext = kind === "sheet" ? ".xlsx" : kind === "doc" ? ".docx" : kind === "slides" ? ".pptx" : "";
  return { name: named ? decodeURIComponent(named) : `google-${kind}-${id.slice(0, 6)}${ext}`, bytes: Buffer.from(await r.arrayBuffer()) };
}
