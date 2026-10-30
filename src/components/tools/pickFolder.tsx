import React from "react";
import { createRoot } from "react-dom/client";
import { FolderPickerDialog } from "./FolderPickerDialog";

/**
 * Picks a folder on the PC: Windows' own dialog when the app is used on the PC, otherwise (a phone, another device,
 * not Windows) the in-app folder browser. Resolves with the path, or null when cancelled.
 */
export function pickFolder(initial?: string, title = "Choose a folder"): Promise<string | null> {
  return new Promise(resolve => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const finish = (p: string | null) => {
      if (done) return;
      done = true;
      resolve(p);
      setTimeout(() => { root.unmount(); host.remove(); }, 0);
    };
    root.render(<FolderPickerDialog open initialPath={initial} title={title} onSelect={p => finish(p)} onOpenChange={o => { if (!o) setTimeout(() => finish(null), 0); }} />);
  });
}
