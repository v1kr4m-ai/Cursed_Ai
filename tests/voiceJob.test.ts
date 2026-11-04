import { describe, expect, it } from "vitest";
import { buildDiaJob } from "../trainTool/voice";

describe("buildDiaJob", () => {
  it("trims the text and leaves out empty options so the script defaults apply", () => {
    const j = buildDiaJob({ text: "  [S1] Hi.  ", output: "o.wav", seed: NaN, cfgScale: 0 });
    expect(j).toEqual({ text: "[S1] Hi.", output: "o.wav" });
  });

  it("passes the reference clip with its transcript and the numeric options", () => {
    const j = buildDiaJob({ text: "[S1] Hi.", output: "o.wav", referenceAudio: "ref.wav", referenceText: " [S1] Hello. ", seed: 7.9, cfgScale: 4, temperature: 1.2 });
    expect(j).toMatchObject({ referenceAudio: "ref.wav", referenceText: "[S1] Hello.", seed: 7, cfgScale: 4, temperature: 1.2 });
  });
});
