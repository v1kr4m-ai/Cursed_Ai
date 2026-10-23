import { describe, expect, it } from "vitest";
import { entriesSince } from "../comfyLogs";
import { appendChunks, emptyLines, MAX_LINES, toneOf } from "../src/components/tools/comfyLines";

const e = (t: string, m: string) => ({ t, m });

describe("ComfyUI console feed", () => {
  const all = [e("2026-10-23T10:00:01", "a"), e("2026-10-23T10:00:02", "\n"), e("2026-10-23T10:00:03", "b")];

  it("sends everything the first time, then only what is new", () => {
    expect(entriesSince(all, "")).toMatchObject({ entries: all, next: "2026-10-23T10:00:03", restarted: false });
    const next = entriesSince(all, "2026-10-23T10:00:02");
    expect(next.entries).toEqual([all[2]]);
    expect(entriesSince(all, "2026-10-23T10:00:03").entries).toEqual([]);
  });

  it("starts over when ComfyUI restarted and its log is older than what the page has", () => {
    const r = entriesSince(all, "2026-10-24T09:00:00");
    expect(r.restarted).toBe(true);
    expect(r.entries).toEqual(all);
  });
});

describe("ComfyUI lines", () => {
  it("puts pieces back together and keeps the unfinished line apart", () => {
    const s = appendChunks(emptyLines(), [e("1", "Total VRAM 8151 MB"), e("2", "\n"), e("3", "got pr"), e("4", "ompt")]);
    expect(s.lines).toEqual(["Total VRAM 8151 MB"]);
    expect(s.partial).toBe("got prompt");
    expect(appendChunks(s, [e("5", "\n")]).lines.at(-1)).toBe("got prompt");
  });

  it("lets a progress bar rewrite its own line and drops colour codes", () => {
    const s = appendChunks(emptyLines(), [e("1", " 10%|#  | 1/10\r 50%|### | 5/10\r100%|####| 10/10\n"), e("2", "\u001b[31mred\u001b[0m\n")]);
    expect(s.lines).toEqual(["100%|####| 10/10", "red"]);
  });

  it("keeps the last few thousand lines", () => {
    const s = appendChunks(emptyLines(), [e("1", Array.from({ length: MAX_LINES + 50 }, (_, i) => `line ${i}`).join("\n") + "\n")]);
    expect(s.lines).toHaveLength(MAX_LINES);
    expect(s.lines.at(-1)).toBe(`line ${MAX_LINES + 49}`);
  });

  it("marks errors, warnings, jobs and progress", () => {
    expect(toneOf("Traceback (most recent call last):")).toBe("error");
    expect(toneOf("torch.OutOfMemoryError: CUDA out of memory")).toBe("error");
    expect(toneOf("UserWarning: something")).toBe("warn");
    expect(toneOf("got prompt")).toBe("run");
    expect(toneOf("Prompt executed in 41.2 seconds")).toBe("run");
    expect(toneOf(" 50%|#####     | 12/24 [00:05<00:05, 2.1it/s]")).toBe("progress");
    expect(toneOf("Starting server")).toBe("plain");
  });
});
