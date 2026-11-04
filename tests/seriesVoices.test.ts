import { describe, it, expect } from "vitest";
import { importLines, rekeyPeople, personVoice, cleanLines, joinLines, isMultiSpeaker, toggleVoiceWord, voiceCastInstruction } from "../seriesTool/voices";
import { sceneFields, formatOf } from "../seriesTool/formats";
import { buildScenePrompt, DEFAULT_VOICE_LOCK } from "../seriesTool/model";
import { tidyPlan } from "../src/components/tools/series/planCheck";
import { renamePerson } from "../src/components/tools/series/people";
import { renameRef } from "../src/components/tools/series/refRename";

const base = { look: "grey grade", voice: "a deep narrator", shot: "A man walks.", card: "", allowCard: false };

describe("voice lookup", () => {
  it("falls back when nothing is set", () => {
    expect(personVoice(undefined, "Meera")).toBeUndefined();
    expect(personVoice({}, "Meera")).toBeUndefined();
    expect(personVoice({ Meera: { voice: "  " } }, "Meera")).toBeUndefined();
    expect(personVoice({ Meera: { voice: "warm" } }, "meera")).toBe("warm");
    expect(personVoice({ Meera: { voice: "warm" } }, undefined)).toBeUndefined();
  });
  it("toggles descriptor words in free text", () => {
    expect(toggleVoiceWord("a low, raspy voice", "warm")).toBe("a low, raspy voice, warm");
    expect(toggleVoiceWord("warm, calm", "warm")).toBe("calm");
  });
});

describe("old single-vo output is unchanged", () => {
  it("voiceover, byte for byte as before", () => {
    const f = sceneFields({ ...base, format: formatOf("narration"), line: "Night fell." });
    expect(f.description).toBe(`integrated_multimodal_description: [Shot 1] ${"grey grade"} ${"A man walks."} A a deep narrator says in an off-screen voiceover: <d>[English] Night fell.</d> No subtitles, captions, lyrics text, watermarks, logos or any other writing appear in the frame.`.replace(/\s+/g, " "));
  });
  it("one unattributed line behaves like vo", () => {
    const a = sceneFields({ ...base, format: formatOf("narration"), line: "Night fell." });
    const b = sceneFields({ ...base, format: formatOf("narration"), line: "Night fell.", lines: [{ text: "Night fell." }], voiceOf: () => "x" });
    expect(b).toEqual(a);
    expect(isMultiSpeaker([{ text: "a" }])).toBe(false);
  });
  it("a minimal old project and scene go through buildScenePrompt with no new fields", () => {
    const project: any = { styleLock: "grey grade", voiceLock: DEFAULT_VOICE_LOCK, settings: {}, episodes: [] };
    const ep: any = { refs: [] };
    const scene: any = { vo: "Night fell.", shot: "A man walks.", textCard: "", refIds: [] };
    const out = buildScenePrompt(project, ep, scene);
    expect(out).toContain("says in an off-screen voiceover: <d>[English] Night fell.</d>");
    // and the same project with empty new fields is identical
    expect(buildScenePrompt({ ...project, people: {} }, ep, { ...scene, lines: [] })).toBe(out);
  });
});

describe("multi-speaker scenes", () => {
  const lines = [{ speaker: "Meera", text: "Where were you?" }, { speaker: "Arjun", text: "Out." }, { text: "They stare." }];
  const voices = { Meera: { voice: "a bright young woman" } };
  it("puts each speaker's own voice in front of their line, project voice as fallback", () => {
    const d = sceneFields({ ...base, format: formatOf("skit"), line: joinLines(lines), lines, voiceOf: n => personVoice(voices, n) }).description;
    expect(d).toContain("Meera (a bright young woman) says, with natural lip movement: <d>[English] Where were you?</d>");
    expect(d).toContain("Arjun (a deep narrator) says, with natural lip movement: <d>[English] Out.</d>");
    expect(d).toContain("<d>[English] They stare.</d>");
  });
  it("narration with a named speaker is attributed", () => {
    const d = sceneFields({ ...base, format: formatOf("narration"), line: "Hi", lines: [{ speaker: "Meera", text: "Hi" }], voiceOf: n => personVoice(voices, n) }).description;
    expect(d).toContain("Meera (a bright young woman) says in an off-screen voiceover: <d>[English] Hi</d>");
  });
  it("no speech format ignores lines", () => {
    expect(sceneFields({ ...base, format: formatOf("cinematic"), line: "x", lines, voiceOf: () => "v" }).description).toContain("Nobody speaks");
  });
  it("rename keeps speakers in step", () => {
    const p: any = { episodes: [{ refs: [], scenes: [{ cast: ["Meera"], lines }] }] };
    expect(renamePerson(p, "Meera", "Mira")[0].scenes[0].lines![0].speaker).toBe("Mira");
  });
});

describe("planner output", () => {
  it("parses lines with and without speaker; old plans unchanged", () => {
    expect(cleanLines(undefined)).toEqual([]);
    expect(cleanLines(["Hi", { speaker: "A", text: "Yo" }, { text: " " }, { name: "B", line: "Hey" }])).toEqual([{ text: "Hi" }, { speaker: "A", text: "Yo" }, { speaker: "B", text: "Hey" }]);
    const old = tidyPlan([{ scenes: [{ number: 1, vo: "Night.", shot: "A road." }] }]);
    expect(old[0].scenes[0].lines).toBeUndefined();
    expect(old[0].scenes[0].vo).toBe("Night.");
    const nu = tidyPlan([{ scenes: [{ number: 1, vo: "Hi Yo", shot: "A road.", lines: [{ speaker: "A", text: "Hi" }] }] }]);
    expect(cleanLines(nu[0].scenes[0].lines)).toEqual([{ speaker: "A", text: "Hi" }]);
  });
  it("tells the planner the cast and voices", () => {
    expect(voiceCastInstruction([], {})).toBe("");
    const t = voiceCastInstruction(["Meera", "Arjun"], { Meera: { voice: "bright" } });
    expect(t).toContain("Meera, Arjun");
    expect(t).toContain("Meera - bright");
  });
});

describe("item 8 review fixes", () => {
  it("malformed lines never throw and blank lines do not change the prompt", () => {
    const f = (lines: any) => sceneFields({ ...base, format: formatOf("narration"), line: "Night fell.", lines }).description;
    const plain = f(undefined);
    expect(f("oops")).toBe(plain);
    expect(f([{ text: 5 }])).toBe(plain);
    expect(f([{ text: "Night fell." }, { speaker: "Meera", text: "  " }])).toBe(plain);
    expect(isMultiSpeaker("x" as any)).toBe(false);
    expect(cleanLines([{ text: 5 }, { text: "ok", speaker: 3 }])).toEqual([{ text: "ok" }]);
  });
  it("plan import caps lines", () => {
    const l = importLines(Array.from({ length: 20 }, () => ({ speaker: "S".repeat(100), text: "t".repeat(900) })));
    expect(l).toHaveLength(12);
    expect(l[0].speaker).toHaveLength(60);
    expect(l[0].text).toHaveLength(600);
  });
  it("voice cast instruction is empty without voices", () => {
    expect(voiceCastInstruction(["Meera"], undefined)).toBe("");
    expect(voiceCastInstruction(["Meera"], { Meera: { voice: "" } })).toBe("");
    expect(voiceCastInstruction(["Meera"], { Meera: { voice: "warm" } })).toContain("Meera - warm");
  });
  it("rekeyPeople keeps the target's voice and is identity when nothing moves", () => {
    const p = { Meera: { voice: "a" }, Asha: { voice: "b" } };
    expect(rekeyPeople(p, "Meera", "Rani")).toEqual({ Asha: { voice: "b" }, Rani: { voice: "a" } });
    expect(rekeyPeople(p, "meera", "ASHA")).toEqual({ Asha: { voice: "b" } });
    expect(rekeyPeople(p, "Nobody", "X")).toBe(p);
    expect(rekeyPeople(undefined, "a", "b")).toBeUndefined();
  });
  it("renameRef renames dialogue speakers and words in lines", () => {
    const ep: any = { id: "e", refs: [{ id: "r", name: "Meera", kind: "person", person: "Meera", role: "character" }], scenes: [
      { shot: "", vo: "Meera runs", textCard: "", promptText: "", lines: [{ speaker: "meera", text: "I am Meera" }, { text: "no one" }] },
      { shot: "", vo: "", textCard: "", promptText: "" },
    ] };
    const [out] = renameRef([ep], "e", "r", "Rani");
    expect(out.scenes[0].lines).toEqual([{ speaker: "Rani", text: "I am Rani" }, { text: "no one" }]);
    expect(out.scenes[1]).not.toHaveProperty("lines");
  });
});
