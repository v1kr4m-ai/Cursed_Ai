/** App-wide popups: any screen (or a background job) can raise one; the ToastHost in App shows it. */
export interface Notice {
  message: string;
  /** success (default), warning or error - decides colour and how long it stays. */
  kind?: "success" | "warning" | "error";
  /** Tab to open when the popup is clicked. */
  tab?: string;
  /** Only show when the user is NOT looking at that tab (or the window is in the background). */
  onlyIfAway?: boolean;
  /** Small preview picture (URL) shown in the popup, e.g. the finished image. */
  thumb?: string;
}

export function notify(n: Notice | string) {
  window.dispatchEvent(new CustomEvent("cursed:notify", { detail: typeof n === "string" ? { message: n } : n }));
}

export const notifyError = (message: string, tab?: string) => notify({ message, kind: "error", tab });
export const notifyWarning = (message: string, tab?: string) => notify({ message, kind: "warning", tab });
