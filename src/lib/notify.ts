/** App-wide popups: any screen (or a background job) can raise one; the ToastHost in App shows it. */
export interface Notice {
  message: string;
  /** Tab to open when the popup is clicked. */
  tab?: string;
  /** Only show when the user is NOT looking at that tab (or the window is in the background). */
  onlyIfAway?: boolean;
}

export function notify(n: Notice | string) {
  window.dispatchEvent(new CustomEvent("cursed:notify", { detail: typeof n === "string" ? { message: n } : n }));
}
