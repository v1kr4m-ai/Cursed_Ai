import { describe, it, expect } from "vitest";
import { keepVoices, tokenCapWithSample, voiceStamp, tokenCap, isEnglishText, cleanForDia, mapSpeakers, planScene, planEpisode, voiceFileName, estimateSeconds } from "../seriesTool/voiceTrack";
import { buildFilter, mixedLength } from "../seriesTool/ffmpeg";
import type { Scene } from "../seriesTool/model";

const scene = (o: Partial<Scene>): Scene => ({ id: "s1", number: 1, vo: "", shot: "", textCard: "", refIds: [], seed: 1, promptText: "", promptEdited: false, status: "pending", clipPath: null, durationS: null, promptId: null, error: null, ...o });
const proj = (o: any = {}) => ({ format: "narration", voice: undefined as string | undefined, people: undefined as any, ...o });

describe("English check and cleaning", () => {
  it("accepts Latin text with accents, numbers and punctuation", () => {
    expect(isEnglishText("Café at 5 o'clock - ready?")).toBe(true);
    expect(isEnglishText("")).toBe(true);
  });
  it("rejects other scripts, even mixed in", () => {
    expect(isEnglishText("नमस्ते दोस्तों")).toBe(false);
    expect(isEnglishText("Hello दोस्त")).toBe(false);
    expect(isEnglishText("こんにちは")).toBe(false);
  });
  it("strips what Dia cannot say but keeps its sound effects", () => {
    expect(cleanForDia("**Wow** 😀 see https://x.io #fun [S2] this (laughs) & that (whispering)")).toBe("Wow see this (laughs) and that");
    expect(cleanForDia("It was—well—“good”")).toBe('It was, well, "good"');
  });
});

describe("speaker mapping", () => {
  it("narrator is S1, named speakers follow in order of appearance", () => {
    const m = mapSpeakers([{ text: "Once." }, { speaker: "Meera", text: "Hi." }, { speaker: "Raj", text: "Yo." }]);
    expect(m.turns.map(t => t.tag)).toEqual(["[S1]", "[S2]", "[S1]"]);
    expect(m.notes[0]).toMatch(/3 different speakers/);
  });
  it("two named speakers, merging consecutive turns of the same speaker", () => {
    const m = mapSpeakers([{ speaker: "A", text: "One." }, { speaker: "a", text: "Two." }, { speaker: "B", text: "Three." }]);
    expect(m.turns).toEqual([{ tag: "[S1]", text: "One. Two." }, { tag: "[S2]", text: "Three." }]);
    expect(m.notes).toEqual([]);
  });
  it("the script always starts with [S1], whoever has a sample", () => {
    const m = mapSpeakers([{ speaker: "A", text: "x" }, { speaker: "B", text: "y" }]);
    expect(m.turns.map(t => t.tag)).toEqual(["[S1]", "[S2]"]);
    expect(m.speakers).toEqual(["A", "B"]);
    const x = planScene(proj({ people: { B: { refAudio: "b.wav", refText: "hi" } } }), { number: 1 }, scene({ lines: [{ speaker: "A", text: "x" }, { speaker: "B", text: "y" }] }));
    expect(x.script.startsWith("[S1]")).toBe(true);
    expect(x.referenceAudio).toBeUndefined();
    expect(x.notes.join(" ")).toMatch(/B's voice sample is not used/);
  });
  it("notes a third speaker's dropped sample", () => {
    const x = planScene(proj({ people: { C: { refAudio: "c.wav" } } }), { number: 1 }, scene({ lines: [{ speaker: "A", text: "x" }, { speaker: "B", text: "y" }, { speaker: "C", text: "z" }] }));
    expect(x.notes.join(" ")).toMatch(/C's voice sample is not used/);
  });
});

describe("scene plans", () => {
  const ep = { number: 2 };
  it("a single narrated line", () => {
    const x = planScene(proj(), ep, scene({ vo: "Night fell on the city.", number: 3 }));
    expect(x.script).toBe("[S1] Night fell on the city.");
    expect(x.file).toBe("voice/s1.wav");
    expect(x.skipped).toBeUndefined();
    expect(x.maxTokens).toBe(tokenCap(x.seconds));
    expect(tokenCap(0)).toBe(300);
  });
  it("two speakers from lines, sample on the first speaker with its tagged transcript", () => {
    const x = planScene(proj({ format: "dialogue", people: { Meera: { refAudio: "m.wav", refText: "Hello there" } } }), ep, scene({ lines: [{ speaker: "Meera", text: "Hi Raj." }, { speaker: "Raj", text: "Hi Meera." }], vo: "Hi Raj. Hi Meera." }));
    expect(x.script).toBe("[S1] Hi Raj. [S2] Hi Meera.");
    expect(x.referenceAudio).toBe("m.wav");
    expect(x.referenceText).toBe("[S1] Hello there");
  });
  it("skips with a reason", () => {
    expect(planScene(proj(), ep, scene({ vo: "" })).skipped).toMatch(/No spoken/);
    expect(planScene(proj(), ep, scene({ vo: "यह हिंदी है" })).skipped).toMatch(/English only/);
    expect(planScene(proj({ voice: "off" }), ep, scene({ vo: "Hello." })).skipped).toMatch(/no spoken voice/);
    expect(planScene(proj(), ep, scene({ vo: "word ".repeat(120) })).skipped).toMatch(/too long/);
    expect(planScene(proj(), ep, scene({ vo: "😀 ***" })).skipped).toMatch(/Nothing speakable/);
  });
  it("plans a whole episode in scene order, or one scene", () => {
    const e = { number: 1, scenes: [scene({ id: "b", number: 2, vo: "Two." }), scene({ id: "a", number: 1, vo: "One." })] } as any;
    expect(planEpisode(proj(), e).map(x => x.number)).toEqual([1, 2]);
    expect(planEpisode(proj(), e, "b").map(x => x.sceneId)).toEqual(["b"]);
  });
  it("names and lengths", () => {
    expect(voiceFileName("ab-12_x")).toBe("voice/ab-12_x.wav");
    expect(voiceFileName("../x")).toBe("voice/___x.wav");
    expect(estimateSeconds("one two three four five six seven")).toBeCloseTo(2.7, 1);
  });
});

describe("mixing voices over clips", () => {
  it("without voices the filter is exactly the old one", () => {
    expect(buildFilter(2, 544, 928, 24, [null, undefined])).toBe(buildFilter(2, 544, 928, 24));
  });
  it("ducks the clip sound and keeps a longer voice by holding the last frame", () => {
    const f = buildFilter(2, 544, 928, 24, [{ input: 2, clip: 5, voice: 7 }, null]);
    expect(f).toContain("[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.2,apad=whole_dur=7.25[c0]");
    expect(f).toContain("[2:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=7.25[s0]");
    expect(f).toContain("tpad=stop_mode=clone:stop_duration=2.25[v0]");
    expect(f).toContain("amix=inputs=2:duration=longest:normalize=0,atrim=duration=7.25[a0]");
    expect(f).toContain("[1:a]aresample=48000,aformat=channel_layouts=stereo[a1]");
    expect(f).toContain("concat=n=2:v=1:a=1[v][a]");
  });
  it("a shorter voice leaves the clip length alone", () => {
    expect(mixedLength(5, 3)).toBe(5);
    expect(buildFilter(1, 10, 10, 24, [{ input: 1, clip: 5, voice: 3 }])).not.toContain("tpad");
  });
});

describe("voice sample budget, stamp and lost updates", () => {
  it("adds the sample's prefill to the token cap, none when its length is unknown", () => {
    expect(tokenCapWithSample(2, 10)).toBe(tokenCap(2) + 860 + 100);
    expect(tokenCapWithSample(2, null)).toBeUndefined();
    const x = planScene(proj({ people: { A: { refAudio: "a.wav" } } }), { number: 1 }, scene({ lines: [{ speaker: "A", text: "Hello there." }] }));
    expect(x.referenceAudio).toBe("a.wav");
    expect(x.maxTokens).toBeUndefined();
  });
  it("the stamp changes with the sample path and transcript", () => {
    const s = scene({ vo: "Hello there friend." });
    const a = voiceStamp(proj(), { number: 1 }, s);
    const b = voiceStamp(proj({ people: { "": {} } }), { number: 1 }, s);
    expect(a).toBe(b);
    const withRef = (audio: string, text: string) => voiceStamp(proj({ people: { Narr: { refAudio: audio, refText: text } } }), { number: 1 }, scene({ lines: [{ speaker: "Narr", text: "Hello there." }] }));
    expect(withRef("a.wav", "x")).not.toBe(withRef("b.wav", "x"));
    expect(withRef("a.wav", "x")).not.toBe(withRef("a.wav", "y"));
  });
  it("an episodes PATCH keeps the voice the job wrote, unless it says null", () => {
    const stored = [{ id: "e", scenes: [{ id: "a", voiceFile: "v.wav", voiceText: "t" }, { id: "b", voiceFile: "w.wav", voiceText: "u" }] }];
    const out = keepVoices(stored, [{ id: "e", scenes: [{ id: "a", vo: "x" }, { id: "b", voiceFile: null, voiceText: null }, { id: "new" }] }] as any);
    expect(out[0].scenes[0]).toEqual({ id: "a", vo: "x", voiceFile: "v.wav", voiceText: "t" });
    expect(out[0].scenes[1]).toEqual({ id: "b", voiceFile: null, voiceText: null });
    expect(out[0].scenes[2]).toEqual({ id: "new" });
  });
});
