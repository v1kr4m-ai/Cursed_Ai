import React from "react";

/** Whether ComfyUI's console is floating over the app (picture-in-picture) instead of sitting in the Console page. Remembered. */
const KEY = "cursed.comfyPip";
const EVENT = "cursed:comfy-pip";

export const isPipped = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function setPipped(on: boolean) {
  try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function usePipped(): boolean {
  const [on, setOn] = React.useState(isPipped);
  React.useEffect(() => {
    const h = (e: Event) => setOn(!!(e as CustomEvent).detail);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  return on;
}
