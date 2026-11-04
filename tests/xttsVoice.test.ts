import { describe, expect, it } from "vitest";
import { BUILTIN_SPEAKERS, XTTS_VOICES, cleanForXtts, detectLanguage, maxChars, planTurns, splitForXtts } from "../seriesTool/xttsPlan";
import { planEpisode, planScene, sampleOf, stampOf, voiceStamp } from "../seriesTool/voiceTrack";
import { inferGender, usesAiVoice } from "../seriesTool/voices";
import { buildScenePrompt, type Episode, type Project, type Scene } from "../seriesTool/model";
import { buildJoinArgs } from "../seriesTool/ffmpeg";
import { buildXttsJob } from "../trainTool/voice";

const scene = (o: Partial<Scene>): Scene => ({ id: "s1", number: 1, vo: "", shot: "A quiet street.", textCard: "", refIds: [], seed: 1, promptText: "", promptEdited: false, status: "pending", clipPath: null, durationS: null, promptId: null, error: null, ...o });
const proj = (o: any = {}) => ({ format: "narration", voice: undefined as string | undefined, people: undefined as any, voiceEngine: "xtts" as any, ...o });
const HI = "नमस्ते दोस्तों, आज हम एक नई कहानी सुनाएँगे।";

describe("detectLanguage", () => {
  it("reads the script", () => {
    expect(detectLanguage(HI)).toBe("hi");
    expect(detectLanguage("Hello there, friend.")).toBe("en");
    expect(detectLanguage("مرحبا بكم")).toBe("ar");
    expect(detectLanguage("你好，世界")).toBe("zh-cn");
    expect(detectLanguage("こんにちは世界")).toBe("ja");
    expect(detectLanguage("안녕하세요")).toBe("ko");
    expect(detectLanguage("Привет, мир")).toBe("ru");
  });
  it("a known script wins even when mixed with Latin words", () => expect(detectLanguage("Hello दोस्त, welcome")).toBe("hi"));
  it("null for a script XTTS has no language for, empty for no letters", () => {
    expect(detectLanguage("வணக்கம்")).toBeNull();
    expect(detectLanguage("1234 !?")).toBe("");
  });
});

describe("splitForXtts", () => {
  it("keeps a short text whole and joins short sentences up to the limit", () => {
    expect(splitForXtts("Hi there. How are you?", "en")).toEqual(["Hi there. How are you?"]);
  });
  it("splits at Hindi sentence marks and never goes over the limit", () => {
    const long = Array.from({ length: 12 }, (_, i) => `यह वाक्य संख्या ${i} है जो काफ़ी लंबा है।`).join(" ");
    const parts = splitForXtts(long, "hi");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.length <= maxChars("hi"))).toBe(true);
    expect(parts.join(" ").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
  });
  it("cuts one endless sentence at commas, then spaces, then hard", () => {
    const one = Array.from({ length: 80 }, (_, i) => `word${i}`).join(", ");
    expect(splitForXtts(one, "en").every(p => p.length <= 230)).toBe(true);
    expect(splitForXtts("a".repeat(500), "en").map(p => p.length)).toEqual([230, 230, 40]);
    expect(splitForXtts("你".repeat(200), "zh-cn").every(p => p.length <= 80)).toBe(true);
  });
  it("does not split numbers like 3.5", () => expect(splitForXtts("It costs 3.5 rupees. Fine.", "en")).toEqual(["It costs 3.5 rupees. Fine."]));
  it("is empty for blank text", () => expect(splitForXtts("  ", "en")).toEqual([]));
});

describe("cleanForXtts", () => {
  it("drops brackets, links and emoji, which would be read aloud", () => expect(cleanForXtts("Wow 😀 (laughs) [S1] see https://x.io #fun **now**")).toBe("Wow see now"));
});

describe("planScene with XTTS", () => {
  const two = [{ speaker: "Meera", text: HI }, { speaker: "Raj", text: "Chalo, let us go." }, { speaker: "Meera", text: "ठीक है।" }];
  it("one turn per speaker change, each with its own language", () => {
    const x = planScene(proj(), { number: 1 }, scene({ lines: two }));
    expect(x.skipped).toBeUndefined();
    expect(x.turns!.map(t => [t.who, t.language])).toEqual([["Meera", "hi"], ["Raj", "en"], ["Meera", "hi"]]);
    expect(BUILTIN_SPEAKERS).toContain(x.turns![0].speaker);
  });
  it("a person keeps the same built-in voice in every scene, whoever speaks first", () => {
    const people = { Meera: { voice: "warm" }, Raj: { voice: "deep" } };
    const a = planScene(proj({ people }), { number: 1 }, scene({ lines: [{ speaker: "Meera", text: "Hi." }, { speaker: "Raj", text: "Yo." }] }));
    const b = planScene(proj({ people }), { number: 1 }, scene({ lines: [{ speaker: "Raj", text: "Yo." }, { speaker: "Meera", text: "Hi." }] }));
    const voiceOf = (x: any, who: string) => x.turns.find((t: any) => t.who === who).speaker;
    expect(voiceOf(a, "Meera")).toBe(voiceOf(b, "Meera"));
    expect(voiceOf(a, "Raj")).toBe(voiceOf(b, "Raj"));
    expect(voiceOf(a, "Meera")).not.toBe(voiceOf(a, "Raj"));
    const n = planScene(proj({ people }), { number: 1 }, scene({ lines: [{ text: "Narr." }, { speaker: "Raj", text: "Yo." }] }));
    expect(n.turns![0].speaker).toBe(BUILTIN_SPEAKERS[0]);
  });
  it("drops only a turn in an unsupported script, with a note; skips the scene when nothing is left", () => {
    const x = planScene(proj(), { number: 1 }, scene({ lines: [{ speaker: "A", text: "வணக்கம்" }, { speaker: "B", text: "Hello there." }] }));
    expect(x.skipped).toBeUndefined();
    expect(x.turns!.map(t => t.who)).toEqual(["B"]);
    expect(x.notes.join(" ")).toMatch(/cannot speak/);
  });
  it("drops turns with no letters or digits", () => {
    const x = planScene(proj(), { number: 1 }, scene({ lines: [{ speaker: "A", text: "..." }, { speaker: "B", text: "।" }, { speaker: "A", text: "Fine." }] }));
    expect(x.turns!.map(t => t.text)).toEqual(["Fine."]);
    expect(planScene(proj(), { number: 1 }, scene({ vo: "!!!" })).skipped).toMatch(/Nothing speakable/);
  });
  it("merges consecutive lines of one speaker", () => {
    const x = planScene(proj(), { number: 1 }, scene({ lines: [{ speaker: "A", text: "One." }, { speaker: "a", text: "Two." }] }));
    expect(x.turns).toHaveLength(1);
    expect(x.turns![0].text).toBe("One. Two.");
  });
  it("every speaker with a sample uses it (Dia could only do the first)", () => {
    const people = { Meera: { refAudio: "m.wav" }, Raj: { refAudio: "r.wav" } };
    const x = planScene(proj({ people }), { number: 1 }, scene({ lines: two }));
    expect(x.turns!.map(t => t.referenceAudio)).toEqual(["m.wav", "r.wav", "m.wav"]);
    expect(x.turns!.every(t => !t.speaker)).toBe(true);
  });
  it("Hindi is not skipped as 'Not English'", () => expect(planScene(proj(), { number: 1 }, scene({ vo: HI })).skipped).toBeUndefined());
  it("skips a script it cannot speak, an empty scene, a silent style", () => {
    expect(planScene(proj(), { number: 1 }, scene({ vo: "வணக்கம் நண்பர்களே" })).skipped).toMatch(/cannot speak this script/);
    expect(planScene(proj(), { number: 1 }, scene({ vo: "" })).skipped).toBe("No spoken line.");
    expect(planScene(proj(), { number: 1 }, scene({ vo: "(laughs)" })).skipped).toMatch(/Nothing speakable/);
    expect(planScene(proj({ format: "dancing" }), { number: 1 }, scene({ vo: HI })).skipped).toBeTruthy();
  });
  it("the stamp changes with the words and with a speaker's sample", () => {
    const a = voiceStamp(proj(), { number: 1 }, scene({ vo: HI }));
    expect(voiceStamp(proj(), { number: 1 }, scene({ vo: HI }))).toBe(a);
    expect(voiceStamp(proj(), { number: 1 }, scene({ vo: HI + " और" }))).not.toBe(a);
    const lines = [{ speaker: "Meera", text: HI }];
    expect(voiceStamp(proj({ people: { Meera: { refAudio: "x.wav" } } }), { number: 1 }, scene({ lines }))).not.toBe(voiceStamp(proj(), { number: 1 }, scene({ lines })));
  });
});

describe("projects without XTTS behave as before", () => {
  it("Dia and unset engines still skip non-English and plan [S1]/[S2] scripts, with no turns", () => {
    for (const voiceEngine of ["dia", undefined]) {
      const hi = planScene(proj({ voiceEngine }), { number: 1 }, scene({ vo: HI }));
      expect(hi.skipped).toBe("Not English: Dia speaks English only.");
      const en = planScene(proj({ voiceEngine }), { number: 1 }, scene({ vo: "Hello there." }));
      expect(en.script).toBe("[S1] Hello there.");
      expect(en.turns).toBeUndefined();
      expect(stampOf(en)).toBe("[S1] Hello there.");
    }
    expect(planEpisode(proj({ voiceEngine: "dia" }), { number: 1, scenes: [scene({ vo: "Hi." })] })).toHaveLength(1);
  });
  it("usesAiVoice", () => {
    expect(usesAiVoice({ voiceEngine: "dia" })).toBe(true);
    expect(usesAiVoice({ voiceEngine: "xtts" })).toBe(true);
    expect(usesAiVoice({ voiceEngine: "model" })).toBe(false);
    expect(usesAiVoice({})).toBe(false);
  });
});

describe("buildXttsJob", () => {
  it("splits every text, defaults the language, and takes a sample over a built-in speaker", () => {
    const j = buildXttsJob("M", [
      { text: " " + HI + " ", language: "hi", output: "a.wav", referenceAudio: " r.wav ", speaker: "Andrew Chipper" },
      { text: "Hello.", language: "klingon", output: "b.wav", speaker: "Andrew Chipper" },
      { text: "Hi.", language: "en", output: "c.wav" },
    ]);
    expect(j.modelDir).toBe("M");
    expect(j.items[0]).toEqual({ text: HI, parts: [HI], language: "hi", output: "a.wav", referenceAudio: "r.wav" });
    expect(j.items[1]).toMatchObject({ language: "hi", speaker: "Andrew Chipper" });
    expect(j.items[2]).toEqual({ text: "Hi.", parts: ["Hi."], language: "en", output: "c.wav" });
  });
});

describe("buildJoinArgs", () => {
  it("pads every turn but the last and concatenates", () => {
    const a = buildJoinArgs(["1.wav", "2.wav", "3.wav"], "o.wav", 0.35);
    const f = a[a.indexOf("-filter_complex") + 1];
    expect(f).toContain("[0:a]apad=pad_dur=0.35[a0]");
    expect(f).toContain("[2:a]anull[a2]");
    expect(f).toContain("[a0][a1][a2]concat=n=3:v=0:a=1[out]");
    expect(a[a.length - 1]).toBe("o.wav");
  });
});

describe("video prompt with a local voice", () => {
  const base = () => {
    const sc = scene({ vo: "Hello world, this is the line.", refIds: [] });
    const episode = { id: "e1", number: 1, title: "P", era: "", hookOut: "", exportPath: null, scenes: [sc], refs: [] } as unknown as Episode;
    const project = { styleLock: "STYLE.", voiceLock: "a narrator", allowTextCards: false, episodes: [episode] } as unknown as Project;
    return { project, episode, sc };
  };
  it("is byte-identical for model, missing and unrelated values", () => {
    const { project, episode, sc } = base();
    const none = buildScenePrompt(project, episode, sc);
    expect(none).toContain("says in an off-screen voiceover: <d>[English] Hello world");
    expect(buildScenePrompt({ ...project, voiceEngine: "model" }, episode, sc)).toBe(none);
  });
  it("leaves the spoken line out for Dia and XTTS but keeps the shot", () => {
    const { project, episode, sc } = base();
    for (const voiceEngine of ["dia", "xtts"] as const) {
      const p = buildScenePrompt({ ...project, voiceEngine }, episode, sc);
      expect(p).not.toContain("<d>");
      expect(p).not.toContain("Hello world");
      expect(p).toContain("A quiet street.");
      expect(p).toContain("Nobody speaks in this clip.");
    }
  });
  it("a scene the local voice skips keeps the model's spoken line", () => {
    const { project, episode, sc } = base();
    const hi = { ...sc, vo: "नमस्ते दोस्तों" };
    const old = buildScenePrompt(project, episode, hi);
    expect(buildScenePrompt({ ...project, voiceEngine: "dia" }, episode, hi)).toBe(old); // Dia cannot speak Hindi
    expect(buildScenePrompt({ ...project, voiceEngine: "xtts" }, episode, hi)).not.toBe(old); // XTTS can
    const tamil = { ...sc, vo: "வணக்கம் நண்பர்களே" };
    expect(buildScenePrompt({ ...project, voiceEngine: "xtts" }, episode, tamil)).toBe(buildScenePrompt(project, episode, tamil));
  });
  it("also for several speakers", () => {
    const { project, episode, sc } = base();
    const s2 = { ...sc, lines: [{ speaker: "Meera", text: "Hi Raj." }, { speaker: "Raj", text: "Hi Meera." }] };
    expect(buildScenePrompt(project, episode, s2)).toContain("<d>[English] Hi Raj.</d>");
    expect(buildScenePrompt({ ...project, voiceEngine: "xtts" }, episode, s2)).not.toContain("Hi Raj");
  });
});

describe("gendered built-in voices", () => {
  const people = { Meera: { voice: "a bright young woman" }, Daniel: { voice: "a calm man" }, Zed: {} };
  const speakerOf = (p: any, lines: { speaker?: string; text: string }[], pv?: string) => Object.fromEntries(planTurns(lines, p, sampleOf, pv).turns.map(t => [t.who, t.speaker]));
  const gender = (n?: string) => XTTS_VOICES.find(v => v.name === n)?.gender;
  const L = (a: string, b: string) => [{ speaker: a, text: "Hello there." }, { speaker: b, text: "Hi, how are you?" }];
  it("female voice for a woman, male for a man, in any speaking order", () => {
    for (const lines of [L("Meera", "Daniel"), L("Daniel", "Meera")]) {
      const s = speakerOf(people, lines);
      expect(gender(s.Meera)).toBe("female"); expect(gender(s.Daniel)).toBe("male");
    }
  });
  it("stable across scenes", () => expect(speakerOf(people, L("Meera", "Daniel"))).toEqual(speakerOf(people, [{ speaker: "Daniel", text: "Ok." }, { speaker: "Meera", text: "Yes." }])));
  it("two women get different voices", () => {
    const s = speakerOf({ A: { gender: "female" }, B: { gender: "female" } }, L("A", "B"));
    expect(s.A).not.toBe(s.B);
  });
  it("an explicit builtinVoice and gender win", () => {
    expect(speakerOf({ Meera: { voice: "woman", builtinVoice: "Luis Moray" } }, L("Meera", "Meera")).Meera).toBe("Luis Moray");
    expect(gender(speakerOf({ Daniel: { voice: "a woman", gender: "male" } }, L("Daniel", "Daniel")).Daniel)).toBe("male");
  });
  it("gender unknown or old projects keep the old slot rule", () => {
    expect(speakerOf({ Zed: {} }, L("Zed", "Zed")).Zed).toBe(BUILTIN_SPEAKERS[1]);
    expect(speakerOf(undefined, L("", ""))[""]).toBe(BUILTIN_SPEAKERS[0]);
  });
  it("the narrator follows the project voice only when it says a gender", () => {
    expect(gender(speakerOf(undefined, [{ text: "Once." }], "a deep baritone")[""])).toBe("male");
    expect(speakerOf(undefined, [{ text: "Once." }], "warm")[""]).toBe(BUILTIN_SPEAKERS[0]);
  });
  it("inferGender reads words only", () => {
    expect(inferGender("A Gentleman, low")).toBe("male"); expect(inferGender("young girl")).toBe("female");
    expect(inferGender("woman and man")).toBeUndefined(); expect(inferGender("Maria")).toBeUndefined();
  });
});
