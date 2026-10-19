import type { StudioKind, StudioRequest } from "../services/studioIntent";

const pending: Record<StudioKind, StudioRequest | null> = { image: null, video: null };

/** Ask an Image / Video studio to take a prompt (and optionally start). Works even if that page was never opened yet. */
export function requestStudio(r: StudioRequest) {
  pending[r.kind] = r;
  window.dispatchEvent(new CustomEvent("cursed:studio", { detail: r }));
}
export function takePending(kind: StudioKind): StudioRequest | null {
  const r = pending[kind];
  pending[kind] = null;
  return r;
}
