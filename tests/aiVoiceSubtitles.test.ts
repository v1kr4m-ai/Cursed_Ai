import { describe, expect, it } from "vitest";
import { aiVoiceCues } from "../seriesTool/subtitlesCore";
import { sceneFields, withoutVoices, SERIES_FORMATS } from "../seriesTool/formats";

const base = { vo: "", offset: 10, maxWords: 4 };
const r = (n: number) => Math.round(n * 100) / 100;

describe("subtitles on a made voice", () => {
  const lines = [{ speaker: "Asha", text: "Namaste doston, kaise ho aap sab" }, { speaker: "Ben", text: "Hello everyone, I am doing fine today" }];
  it("XTTS turns: each speaker's cues sit inside that turn, never merged", () => {
    const cues = aiVoiceCues({ ...base, lines, turns: [{ speaker: "Asha", seconds: 6 }, { speaker: "Ben", seconds: 4 }], voiceLen: 10.35, dur: 12 });
    const a = cues.filter(c => /Namaste|doston|kaise|aap|sab/.test(c.text)), b = cues.filter(c => /Hello|everyone|fine|today/.test(c.text));
    expect(r(a[0].start)).toBe(10); expect(r(a[a.length - 1].end)).toBe(16);
    expect(r(b[0].start)).toBe(16.35); expect(r(b[b.length - 1].end)).toBe(20.35);
    expect(cues.some(c => /Namaste/.test(c.text) && /Hello/.test(c.text))).toBe(false);
  });
  it("Dia (no turns): lines share the real voice length, one group per line", () => {
    const cues = aiVoiceCues({ ...base, lines, voiceLen: 8, dur: 8 });
    expect(r(cues[0].start)).toBe(10); expect(r(cues[cues.length - 1].end)).toBe(18);
    expect(cues.some(c => /Namaste/.test(c.text) && /Hello/.test(c.text))).toBe(false);
  });
  it("no lines: the single vo line spans the voice", () => {
    const cues = aiVoiceCues({ ...base, lines: [], vo: "one two three four five six", voiceLen: 5, dur: 5 });
    expect(r(cues[0].start)).toBe(10); expect(r(cues[cues.length - 1].end)).toBe(15);
  });
  it("voice longer than the clip: nothing runs past the scene length", () => {
    const cues = aiVoiceCues({ ...base, lines, voiceLen: 20, dur: 12 });
    expect(Math.max(...cues.map(c => c.end))).toBeLessThanOrEqual(22);
  });
});

describe("sound line with a made voice", () => {
  const f = (id: string, extra: object) => sceneFields({ format: SERIES_FORMATS.find(x => x.id === id)!, look: "", voice: "v", line: "Hello there", shot: "A room.", card: "", allowCard: false, ...extra });
  it("model/missing engine is unchanged", () => {
    for (const x of SERIES_FORMATS) expect(f(x.id, { aiVoice: false }).soundscape).toBe(`overall_soundscape: ${x.sound}`);
  });
  it("AI voice: no voice phrase left in the sound line, ambience kept", () => {
    for (const x of SERIES_FORMATS.filter(x => ["voiceover", "oncamera", "dialogue"].includes(x.speech))) {
      const s = f(x.id, { aiVoice: true }).soundscape;
      expect(s, x.id).not.toMatch(/voice/i);
      expect(s.length).toBeGreaterThan("overall_soundscape: ".length + 5);
    }
    expect(withoutVoices("The people's own voices, close and clear, with the natural sound of the place.")).toBe("The natural sound of the place.");
  });
});
