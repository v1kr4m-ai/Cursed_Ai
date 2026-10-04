/** Turns raw failures into something a person can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "Something went wrong");
  // fetch() rejects with a bare TypeError when the server itself can't be reached.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Can't reach the Cursed_Ai server. Make sure it's running (double-click start.bat) and try again.";
  }
  if (/could not reach comfyui/i.test(msg)) {
    return `${msg} Open the Image or Video tab and press "Start ComfyUI".`;
  }
  if (/could not reach (ollama|lm studio)/i.test(msg)) {
    return `${msg} Start the app, then try again.`;
  }
  if (/inference already in progress/i.test(msg)) {
    return "The model is still busy with another request. Stop it or wait a moment, then try again.";
  }
  if (/GEMINI_API_KEY|api key/i.test(msg)) {
    return "Cloud generation needs a Gemini API key. Add GEMINI_API_KEY to .env.local and restart, or switch to Local.";
  }
  return msg;
}
