import { describe, it, expect } from "vitest";
import { MAX_TALK_SECONDS, TURN_GAP, isMultiSpeaker, turnsMatchVoice, pieceLengths, planTurnRenders, pickTurnPicture, isTalking, joinVoice, limitChunks, pickTalkingPicture, planTalking, talkingSize, talkingStale, type PicRef } from "../seriesTool/talking";
import { buildFilter, buildTalkingTrimArgs, buildTalkingPieceArgs, buildTalkingConcatArgs } from "../seriesTool/ffmpeg";
import { keepVoices } from "../seriesTool/voiceTrack";
import { unusedTakes } from "../seriesTool/takes";
import { copyEpisode } from "../src/components/tools/series/EpisodeManager";
import fs from "fs";
import os from "os";
import path from "path";

const ref = (id: string, over: Partial<PicRef> = {}): PicRef => ({ id, name: id, role: "character", kind: "person", prompt: "", file: `C:/${id}.png`, ...over });
const has = () => true;

describe("planTalking", () => {
  it("one chunk covers a short voice, more chunks for longer ones", () => {
    expect(planTalking(3.2)).toMatchObject({ chunks: 1, tooLong: false });
    expect(planTalking(4.6).chunks).toBe(1);
    expect(planTalking(5).chunks).toBe(2);
    expect(planTalking(9.6).chunks).toBe(3);
  });
  it("refuses a voice longer than the workflow can carry, never caps it silently", () => {
    expect(planTalking(MAX_TALK_SECONDS).tooLong).toBe(false);
    expect(planTalking(MAX_TALK_SECONDS + 0.5)).toMatchObject({ chunks: 3, tooLong: true });
  });
});

describe("talkingSize", () => {
  it("keeps the shape, long side 640, multiples of 16", () => {
    expect(talkingSize(1080, 1920)).toEqual({ width: 368, height: 640 });
    expect(talkingSize(1280, 720)).toEqual({ width: 640, height: 368 });
  });
});

describe("pickTalkingPicture", () => {
  const scene = (o: object = {}) => ({ refIds: ["a", "b"], ...o });
  it("takes the speaker's attached photo before a made still", () => {
    const refs = [ref("a", { person: "Richie", prompt: "a still" }), ref("b", { person: "Richie" })];
    expect((pickTalkingPicture(refs, scene({ cast: ["Richie"] }), has) as any).ref.id).toBe("b");
  });
  it("picks the speaker of the first line, not another person", () => {
    const refs = [ref("a", { person: "Mona" }), ref("b", { person: "Richie" })];
    expect((pickTalkingPicture(refs, scene({ lines: [{ speaker: "Richie", text: "hi" }] }), has) as any).ref.id).toBe("b");
  });
  it("falls back to the speaker's picture elsewhere in the episode, then refuses with a reason", () => {
    const refs = [ref("c", { person: "Richie" }), ref("a", { person: "Mona" })];
    expect((pickTalkingPicture(refs, scene({ refIds: ["a"], cast: ["Richie"] }), has) as any).ref.id).toBe("c");
    const none = pickTalkingPicture([ref("a", { person: "Mona" })], scene({ refIds: ["a"], cast: ["Richie"] }), has);
    expect((none as any).reason).toMatch(/Richie/);
  });
  it("skips skipped, missing and non-person pictures; with no speaker the first person picture is used", () => {
    const refs = [ref("a", { skip: true }), ref("b", { kind: "outfit" }), ref("c", { file: "C:/gone.png" }), ref("d")];
    expect((pickTalkingPicture(refs, { refIds: ["a", "b", "c", "d"] }, f => !f.includes("gone")) as any).ref.id).toBe("d");
    expect("reason" in pickTalkingPicture([ref("a", { skip: true })], { refIds: ["a"] }, has)).toBe(true);
  });
});

describe("limitChunks", () => {
  const g = () => ({ "3": {}, "79:78": {}, "85:78": {}, "94": { class_type: "LatentCut", inputs: { samples: ["85:78", 0] } }, "95": { class_type: "LatentConcat", inputs: { samples1: ["94", 0], samples2: ["85:78", 0] } } }) as any;
  it("points the final cut and concat at the last wanted chunk", () => {
    const one = g(); expect(limitChunks(one, 1)).toBe(true);
    expect(one["94"].inputs.samples).toEqual(["3", 0]); expect(one["95"].inputs.samples2).toEqual(["3", 0]); expect(one["95"].inputs.samples1).toEqual(["94", 0]);
    const two = g(); expect(limitChunks(two, 2)).toBe(true); expect(two["95"].inputs.samples2).toEqual(["79:78", 0]);
  });
  it("leaves the graph alone for three chunks or an unknown layout", () => {
    const three = g(); expect(limitChunks(three, 3)).toBe(false); expect(three["94"].inputs.samples).toEqual(["85:78", 0]);
    expect(limitChunks({ "94": {} } as any, 1)).toBe(false);
  });
  it("refuses a graph whose nodes are of another class or link shape (the job then fails instead of running 3 chunks)", () => {
    const a = g(); a["94"].class_type = "SomethingElse"; expect(limitChunks(a, 1)).toBe(false);
    const b = g(); b["95"].inputs.samples2 = ["85:78"]; expect(limitChunks(b, 2)).toBe(false);
    expect(b["94"].inputs.samples).toEqual(["85:78", 0]);
  });
});

describe("joining a talking scene", () => {
  const normal = { voiceFile: "v.wav", clipPath: "c1.mp4" };
  const talk = { voiceFile: "v.wav", clipPath: "c2.mp4", talking: true, talkingClip: "c2.mp4" };
  it("a normal clip gets the voice mixed over it, a talking clip does not (the voice is not laid on twice)", () => {
    expect(joinVoice(normal)).toBe("v.wav");
    expect(joinVoice(talk)).toBeUndefined();
    expect(isTalking(talk)).toBe(true);
  });
  it("a later take or normal render makes the scene a normal one again", () => {
    expect(isTalking({ ...talk, clipPath: "other.mp4" })).toBe(false);
    expect(joinVoice({ ...talk, clipPath: "other.mp4" })).toBe("v.wav");
  });
  it("the filter keeps the talking clip's own sound at full level and mixes only the normal one", () => {
    const f = buildFilter(2, 640, 360, 24, [{ input: 2, clip: 5, voice: 4 }, null]);
    expect(f).toContain("[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.2");
    expect(f).toContain("[1:a]aresample=48000,aformat=channel_layouts=stereo[a1]");
    expect(f).not.toContain("volume=0.2,apad=whole_dur=NaN");
  });
  it("trim args cut at the voice length and level the sound", () => {
    const a = buildTalkingTrimArgs("in.mp4", "out.mp4", 4.25);
    expect(a).toContain("4.25"); expect(a.join(" ")).toContain("loudnorm"); expect(a[a.length - 1]).toBe("out.mp4");
  });
});

describe("talking clip bookkeeping", () => {
  const t = { clipPath: "t.mp4", talkingClip: "t.mp4", voiceText: "v1", talkingVoice: "v1" };
  it("a revert and re-pick of the talking take is still a talking clip (no double voice)", () => {
    const reverted = { ...t, clipPath: "old.mp4", talking: false };
    expect(isTalking(reverted)).toBe(false);
    expect(joinVoice({ ...reverted, voiceFile: "v.wav", clipPath: "t.mp4" })).toBeUndefined();
  });
  it("is stale once the voice was made again", () => {
    expect(talkingStale(t)).toBe(false);
    expect(talkingStale({ ...t, voiceText: "v2" })).toBe(true);
    expect(talkingStale({ ...t, clipPath: "other.mp4", voiceText: "v2" })).toBe(false);
  });
  it("Delete unused takes keeps the clip to go back to and the talking take", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-"));
    const names = ["ep01_scene01.mp4", "ep01_scene01_20260101_000000.mp4", "ep01_scene01_20260102_000000.mp4", "ep01_scene01_20260103_000000.mp4"];
    names.forEach(n => fs.writeFileSync(path.join(dir, n), "x"));
    const sc = { number: 1, clipPath: path.join(dir, names[3]), clipBeforeTalking: path.join(dir, names[0]), talkingClip: path.join(dir, names[1]) };
    expect(unusedTakes(dir, [{ number: 1, scenes: [sc] }]).map(x => path.basename(x.path))).toEqual([names[2]]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("a copied episode carries no talking clip", () => {
    const e: any = { id: "e", title: "T", refs: [], scenes: [{ id: "s", number: 1, refIds: [], clipPath: "c", talking: true, talkingClip: "c", clipBeforeTalking: "o", talkingVoice: "v" }] };
    const c = copyEpisode(e).scenes[0];
    expect([c.talking, c.talkingClip, c.clipBeforeTalking, c.talkingVoice]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("several speakers in one talking scene", () => {
  const t = (speaker: string, seconds: number, n = 0) => ({ speaker, seconds, file: `v_t${n}.wav` });
  it("only turns by 2+ different speakers make a per-turn scene; old scenes (no turns) and one speaker stay as today", () => {
    expect(isMultiSpeaker(undefined)).toBe(false);
    expect(isMultiSpeaker([t("Mona", 3), t("mona ", 2, 1)])).toBe(false);
    expect(isMultiSpeaker([t("Mona", 3), t("Richie", 2, 1)])).toBe(true);
  });
  it("one render per turn, in order", () => {
    const p = planTurnRenders([t("Mona", 3), t("Richie", 2, 1), t("Mona", 4, 2)]) as any;
    expect(p.renders.map((r: any) => r.speaker)).toEqual(["Mona", "Richie", "Mona"]);
    expect(p.chunks).toBe(3);
  });
  it("merges neighbouring turns of one speaker while the whole fits, with the join gap", () => {
    const p = planTurnRenders([t("Mona", 3), t("Mona", 2, 1), t("Richie", 2, 2)]) as any;
    expect(p.renders).toHaveLength(2);
    expect(p.renders[0].files).toEqual(["v_t0.wav", "v_t1.wav"]);
    expect(p.renders[0].seconds).toBeCloseTo(5 + TURN_GAP);
    const long = planTurnRenders([t("Mona", 8), t("Mona", 8, 1), t("Richie", 2, 2)]) as any;
    expect(long.renders).toHaveLength(3);
  });
  it("refuses a turn longer than one clip with the speaker named, cutting nothing", () => {
    const p = planTurnRenders([t("Mona", 3), t("Richie", MAX_TALK_SECONDS + 0.5, 1)]) as any;
    expect(p.reason).toMatch(/Richie/);
    expect(p.renders).toBeUndefined();
  });
  it("each speaker gets their own picture; a missing one is refused by name", () => {
    const refs = [ref("a", { person: "Mona" }), ref("b", { person: "Richie" })];
    const scene = { refIds: ["a", "b"], lines: [{ speaker: "Mona", text: "hi" }] };
    expect((pickTurnPicture(refs, scene, "Richie", has) as any).ref.id).toBe("b");
    expect((pickTurnPicture(refs, scene, "Mona", has) as any).ref.id).toBe("a");
    expect((pickTurnPicture([ref("a", { person: "Mona" })], { refIds: ["a"] }, "Richie", has) as any).reason).toMatch(/Richie/);
  });
  it("piece and concat args: exact length, pieces joined in order", () => {
    const a = buildTalkingPieceArgs("raw.mp4", "p0.mp4", 3.35);
    expect(a).toContain("3.35"); expect(a.join(" ")).toContain("tpad"); expect(a[a.length - 1]).toBe("p0.mp4");
    const c = buildTalkingConcatArgs(["p0.mp4", "p1.mp4"], "out.mp4");
    expect(c.join(" ")).toContain("[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]");
    expect(c.indexOf("p0.mp4")).toBeLessThan(c.indexOf("p1.mp4")); expect(c[c.length - 1]).toBe("out.mp4");
  });
  it("the kept turns survive a save from the UI", () => {
    const turns = [t("Mona", 3)];
    const kept = keepVoices([{ id: "e", scenes: [{ id: "s", voiceTurns: turns }] }], [{ id: "e", scenes: [{ id: "s" }] }]);
    expect((kept[0].scenes[0] as any).voiceTurns).toEqual(turns);
  });
  it("turns belong to the voice only while their lengths plus gaps match the file", () => {
    const ts = [t("Mona", 3), t("Richie", 2, 1)];
    expect(turnsMatchVoice(ts, 5.35)).toBe(true);
    expect(turnsMatchVoice(ts, 5.4)).toBe(true);
    expect(turnsMatchVoice(ts, 7)).toBe(false);
    expect(turnsMatchVoice([], 0)).toBe(false);
  });
  it("piece cuts land on frames and never drift from the joined voice", () => {
    const secs = [1.03, 1.03, 1.03, 1.03, 1.03, 1.03];
    const cuts = pieceLengths(secs);
    const total = cuts.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - (secs.reduce((a, b) => a + b, 0) + TURN_GAP * 5 + 0.25))).toBeLessThan(1 / 16);
    cuts.forEach(c => expect(Math.abs(c * 16 - Math.round(c * 16))).toBeLessThan(1e-9));
  });
});
