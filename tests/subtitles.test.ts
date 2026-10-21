import { describe, expect, it } from "vitest";
import { assColor, buildAss, buildSrt, chunkWords, cleanCues, DEFAULT_SUB_STYLE, makeCues, speechSpan } from "../seriesTool/subtitlesCore";

describe("subtitles", () => {
  it("chunks words, breaking after punctuation", () => {
    expect(chunkWords("The long night began, and the wolves came down from the north", 4)).toEqual(["The long night began,", "and the wolves came", "down from the north"]);
  });

  it("times cues across the speech in proportion to length and keeps them in order", () => {
    const cues = makeCues("one two three four five six seven eight", 1, 5, 4);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[1].end).toBeCloseTo(5, 1);
    expect(cues[0].end).toBeCloseTo(cues[1].start, 1);
  });

  it("finds where speech starts and stops", () => {
    const rate = 16000, s = new Float32Array(rate * 4);
    for (let i = rate; i < rate * 3; i++) s[i] = Math.sin(i / 20) * 0.3;
    const span = speechSpan(s, rate);
    expect(span.start).toBeGreaterThan(0.8);
    expect(span.start).toBeLessThan(1.05);
    expect(span.end).toBeGreaterThan(2.95);
    expect(span.end).toBeLessThan(3.4);
  });

  it("writes ASS with BGR colours, position and uppercase", () => {
    expect(assColor("#ff8000")).toBe("&H000080FF");
    const ass = buildAss([{ id: "a", start: 0, end: 1.5, text: "hi there" }], { ...DEFAULT_SUB_STYLE, uppercase: true, position: "top", font: "Impact" }, 720, 1280);
    expect(ass).toContain("Style: Default,Impact,");
    expect(ass).toContain(",8,"); // top alignment
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,HI THERE");
  });

  it("writes a standard srt", () => {
    expect(buildSrt([{ id: "a", start: 1.5, end: 3.25, text: "Hello" }, { id: "b", start: 3600.5, end: 3601, text: "Later" }])).toBe("1\n00:00:01,500 --> 00:00:03,250\nHello\n\n2\n01:00:00,500 --> 01:00:01,000\nLater\n");
  });

  it("drops broken cues from edits", () => {
    expect(cleanCues([{ start: 2, end: 1, text: "x" }, { start: 3, end: 4, text: "ok" }, { start: "a", end: 2, text: "y" }]).map(c => c.text)).toEqual(["ok"]);
  });
});
