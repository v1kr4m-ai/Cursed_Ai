import React from "react";
import type { Project } from "./api";

/**
 * Which clips and finished episodes you have already looked at, so the new ones can say "New". Kept in this browser,
 * per series. A series seen for the first time counts everything it already has as seen (only what arrives after
 * that is new).
 */
const key = (id: string) => `cursed.series.seen.${id}`;
const EVENT = "cursed:series-seen";

const read = (id: string): Set<string> | null => {
  try { const v = JSON.parse(localStorage.getItem(key(id)) || "null"); return Array.isArray(v) ? new Set<string>(v) : null; } catch { return null; }
};
const write = (id: string, s: Set<string>) => {
  try { localStorage.setItem(key(id), JSON.stringify([...s].slice(-3000))); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
};

/** Every clip and finished video a series has right now. */
export function mediaOf(p: Project): string[] {
  const out: string[] = [];
  for (const e of p.episodes) {
    for (const s of e.scenes) if (s.clipPath) out.push(s.clipPath);
    if (e.exportPath) out.push(e.exportPath);
    for (const o of e.outputs || []) if (o.path) out.push(o.path);
  }
  return out;
}

/** First time this series is opened in this browser: what is there already is not new. */
export function baselineSeen(p: Project) {
  if (read(p.id)) return;
  write(p.id, new Set(mediaOf(p)));
}

export function markSeen(projectId: string, ...paths: (string | null | undefined)[]) {
  const s = read(projectId) || new Set<string>();
  let changed = false;
  for (const x of paths) if (x && !s.has(x)) { s.add(x); changed = true; }
  if (changed) write(projectId, s);
}

/** Re-renders when anything is marked seen. `isNew(path)` is true for a file that exists and has not been looked at. */
export function useSeen(projectId: string) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent).detail === projectId) tick(n => n + 1); };
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, [projectId]);
  const set = read(projectId);
  return { isNew: (path?: string | null) => !!path && !!set && !set.has(path) };
}
