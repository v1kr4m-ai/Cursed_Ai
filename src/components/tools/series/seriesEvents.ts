/**
 * One shared stream of series events for the whole page. Browsers allow only about six open connections per site,
 * and every extra live stream steals one from the video previews, so the notifier and the open series share this one.
 */
type Listener = (event: Record<string, any>) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

export function onSeriesEvent(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/series/events");
    source.onmessage = e => {
      let data: Record<string, any>;
      try { data = JSON.parse(e.data); } catch { return; } // heartbeat
      for (const l of listeners) l(data);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && source) { source.close(); source = null; }
  };
}
