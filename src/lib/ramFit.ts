import React from "react";

const GB = 1024 ** 3;

export interface SystemInfo { totalBytes: number; freeBytes: number }
export interface Fit { level: "ok" | "tight" | "no"; label: string; detail: string }

/** Rough memory a GGUF needs while running: the weights, ~15% for the context/cache, plus runtime overhead. */
export const needBytes = (fileBytes: number) => fileBytes * 1.15 + 0.5 * GB;

const fmt = (b: number) => `${(b / GB).toFixed(1)} GB`;

/** Will a model of this file size run on this machine? Null when the size is unknown (e.g. cloud models). */
export function fitFor(fileBytes: number | undefined, sys: SystemInfo | null): Fit | null {
  if (!fileBytes || !sys) return null;
  const need = needBytes(fileBytes);
  const detail = `Needs about ${fmt(need)}. This PC has ${fmt(sys.totalBytes)} RAM (${fmt(sys.freeBytes)} free right now).`;
  // Free memory swings with whatever else is open, so it only adds a warning; the verdict uses total RAM.
  const lowFree = need > sys.freeBytes ? " Free memory is low right now - close other apps or unload models first." : "";
  if (need <= sys.totalBytes * 0.6) return { level: "ok", label: "Fits your RAM", detail: detail + lowFree };
  if (need <= sys.totalBytes * 0.85) return { level: "tight", label: "Tight fit", detail: detail + " It may be slow or fail if other apps use memory." + lowFree };
  return { level: "no", label: "Too big", detail: detail + " Pick a smaller model or a lower quantization." };
}

/** "8b" / "135m" parameter counts to an approximate 4-bit file size (what Ollama downloads by default). */
export function paramsToBytes(tag: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([mb])$/i.exec(tag.trim());
  if (!m) return undefined;
  return parseFloat(m[1]) * (m[2].toLowerCase() === "b" ? 1e9 : 1e6) * 0.6;
}

/** "2.3 GB" / "600 MB" to bytes. */
export function parseSize(text: string): number | undefined {
  const m = /^([\d.]+)\s*(GB|MB)$/i.exec(text.trim());
  if (!m) return undefined;
  return parseFloat(m[1]) * (m[2].toUpperCase() === "GB" ? GB : 1024 ** 2);
}

let systemPromise: Promise<SystemInfo | null> | null = null;
/** This PC's memory, fetched once from the local server. */
export function useSystemInfo(): SystemInfo | null {
  const [info, setInfo] = React.useState<SystemInfo | null>(null);
  React.useEffect(() => {
    if (!systemPromise) {
      systemPromise = fetch("/api/system").then(r => r.json()).catch(() => null);
      setTimeout(() => { systemPromise = null; }, 30000); // free memory changes; refresh now and then
    }
    systemPromise.then(setInfo);
  }, []);
  return info;
}
