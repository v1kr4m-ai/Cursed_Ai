import React from "react";
import { notify } from "../../../lib/notify";
import { onSeriesEvent } from "./seriesEvents";

/**
 * Tells you when a series render ends, wherever you are in the app: one notice when the queue is done
 * (clips made, any that failed) and one for each clip or picture that failed, with the reason.
 */
export function SeriesNotifier() {
  React.useEffect(() => {
    return onSeriesEvent(d => {
      {
        const name = d.title || "Series";
        if (d.type === "failed") {
          notify({ message: `${name}: a render failed - ${String(d.error || "unknown error").slice(0, 200)}`, kind: "error", tab: "series" });
        } else if (d.type === "idle") {
          const failed = d.failed ? `, ${d.failed} failed` : "";
          notify({ message: `${name}: rendering finished - ${d.done} done${failed}`, kind: d.failed ? "warning" : "success", tab: "series" });
        } else if (d.type === "stitched") {
          notify({ message: `${name}: episode joined`, tab: "series" });
        }
      }
    });
  }, []);
  return null;
}
