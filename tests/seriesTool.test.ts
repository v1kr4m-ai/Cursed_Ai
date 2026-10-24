import { describe, expect, it } from "vitest";
import { buildScenePrompt, snapFrames, type Episode, type Project, type Scene } from "../seriesTool/model";
import { buildFilter } from "../seriesTool/ffmpeg";
import { extractJson } from "../src/components/tools/series/api";
import { planProblems, tidyPlan } from "../src/components/tools/series/planCheck";
import { judgeImage, judgeVideo, suggestions, type WfInfo } from "../src/components/tools/series/workflows";
import { kindOf, kindRank } from "../seriesTool/refKinds";
import fs from "fs";
import os from "os";
import path from "path";
import { peopleOf, ensureCast, renamePerson, setSkip, adoptPlannedPeople, mentions } from "../src/components/tools/series/people";
import { fillSlots, refSourceFiles } from "../seriesTool/refSources";
import { projectFormat, SERIES_FORMATS } from "../seriesTool/formats";
import { isChatModel, paramsFromName, rateModel, recommend } from "../src/components/tools/series/modelRating";
import { formatOf } from "../seriesTool/formats";

describe("snapFrames", () => {
  it("lands on the model's 17k+5 grid", () => {
    for (const seconds of [5, 6, 7, 8, 10, 15]) {
      const frames = snapFrames(seconds, 24);
      expect((frames - 5) % 17).toBe(0);
      expect(frames).toBeGreaterThanOrEqual(seconds * 24);
    }
  });

  it("keeps the known durations", () => {
    expect(snapFrames(5, 24)).toBe(124);
    expect(snapFrames(7, 24)).toBe(175);
    expect(snapFrames(8, 24)).toBe(192);
  });
});

function fixture(): { project: Project; episode: Episode; scene: Scene } {
  const scene: Scene = {
    id: "s1", number: 1, vo: "Twelve thousand years before dragons, this continent already belonged to someone else entirely.",
    shot: "An aerial wide shot descends through grey mist.", textCard: "PART 1",
    refIds: ["r1", "r2"], seed: 1, promptText: "", promptEdited: false,
    status: "pending", clipPath: null, durationS: null, promptId: null, error: null,
  };
  const episode: Episode = {
    id: "e1", number: 1, title: "Pilot", era: "dawn", hookOut: "next", exportPath: null, scenes: [scene],
    refs: [
      { id: "r1", name: "style_plate", role: "style", prompt: "", negative: "", seed: 1, file: "a.png", status: "done", error: null },
      { id: "r2", name: "the giant", role: "character", prompt: "", negative: "", seed: 2, file: "b.png", status: "done", error: null },
    ],
  };
  const project = {
    styleLock: "STYLE_LOCK.", voiceLock: "a narrator (S1)", allowTextCards: true, episodes: [episode],
  } as unknown as Project;
  return { project, episode, scene };
}

describe("buildScenePrompt", () => {
  it("numbers references in the order the scene lists them", () => {
    const { project, episode, scene } = fixture();
    const prompt = buildScenePrompt(project, episode, scene);
    expect(prompt).toContain("Use <Picture 1> as the visual style reference");
    expect(prompt).toContain("Use <Picture 2> as the exact appearance reference for the giant");
  });

  it("carries the locks and the three fields the model expects", () => {
    const { project, episode, scene } = fixture();
    const prompt = buildScenePrompt(project, episode, scene);
    expect(prompt).toContain("STYLE_LOCK.");
    expect(prompt).toContain("A a narrator (S1) says in an off-screen voiceover: <d>[English]");
    expect(prompt).toContain('Plain white text reading "PART 1"');
    for (const key of ["integrated_multimodal_description:", "overall_soundscape:", "non_diegetic_music:"]) {
      expect(prompt).toContain(key);
    }
  });

  it("never writes subtitles into the picture, and drops caption words from the look", () => {
    const { project, episode, scene } = fixture();
    const prompt = buildScenePrompt({ ...project, allowTextCards: false, styleLock: "natural light, captions, emoticons, close-ups" }, episode, scene);
    expect(prompt).not.toContain("Plain white text reading");
    expect(prompt).toContain("No subtitles, captions");
    expect(prompt).toContain("natural light, emoticons, close-ups");
    expect(prompt).not.toContain("light, captions");
  });

  it("words the line for the chosen format", () => {
    const { project, episode, scene } = fixture();
    const vlog = buildScenePrompt({ ...project, format: "vlog" }, episode, scene);
    expect(vlog).toContain("looks at the camera and says");
    expect(vlog).not.toContain("off-screen voiceover");
    expect(buildScenePrompt({ ...project, format: "singing" }, episode, scene)).toContain("sings this lyric");
    const dance = buildScenePrompt({ ...project, format: "dancing" }, episode, scene);
    expect(dance).toContain("Nobody speaks");
    expect(dance).not.toContain("<d>");
  });

  it("leaves the text card out when the scene has none", () => {
    const { project, episode, scene } = fixture();
    const prompt = buildScenePrompt(project, episode, { ...scene, textCard: "" });
    expect(prompt).not.toContain("Plain white text reading");
  });
});

describe("buildFilter", () => {
  it("normalises every input and concatenates the right count", () => {
    const filter = buildFilter(3, 544, 928, 24);
    expect(filter).toContain("[0:v]scale=544:928");
    expect(filter).toContain("[2:a]aresample=48000");
    expect(filter).toContain("concat=n=3:v=1:a=1[v][a]");
  });
});

describe("extractJson", () => {
  it("reads a plan out of a fenced block with prose around it", () => {
    const answer = 'Sure, here is the plan:\n```json\n[{"number":1,"title":"One"}]\n```\nLet me know.';
    expect(extractJson(answer)[0].title).toBe("One");
  });

  it("reads a bare array and ignores braces inside strings", () => {
    expect(extractJson('[{"title":"a } weird ] title"}]')[0].title).toBe("a } weird ] title");
  });

  it("skips a <think> block, and finds nothing when it never closes", () => {
    expect(extractJson('<think>maybe [1,2] or {x}</think>[{"title":"a"}]')[0].title).toBe("a");
    expect(() => extractJson('<think>I keep thinking [{"title":"no"}]')).toThrow(/usable plan/);
  });

  it("keeps the complete episodes when the answer was cut off", () => {
    const cut = '[{"number":1,"title":"One","scenes":[{"vo":"a"}]},{"number":2,"title":"Two","scenes":[{"vo":"b"},{"vo":"unfini';
    const plan = extractJson(cut);
    expect(plan).toHaveLength(2);
    expect(plan[1].scenes).toEqual([{ vo: "b" }]);
  });

  it("complains when there is no plan to find", () => {
    expect(() => extractJson("I could not do that.")).toThrow(/did not contain a usable plan/);
  });
});

describe("planCheck", () => {
  const ugc = formatOf("ugc");
  it("maps other field names and flags scenes with no shot", () => {
    const plan = tidyPlan([{ number: 1, scenes: [{ number: 1, vo: "hi there", visual: "Selfie in a kitchen" }, { number: 2, line: "second line" }] }]);
    expect(plan[0].scenes[0].shot).toBe("Selfie in a kitchen");
    const problem = planProblems(plan, ugc);
    expect(problem).toContain("episode 1 scene 2");
    expect(problem).not.toContain("scene 1,");
  });

  it("accepts a plan whose scenes are complete, and does not need a line for a silent style", () => {
    expect(planProblems([{ number: 1, scenes: [{ number: 1, vo: "a", shot: "b" }] }], ugc)).toBe("");
    expect(planProblems([{ number: 1, scenes: [{ number: 1, vo: "", shot: "dance" }] }], formatOf("dancing"))).toBe("");
  });
});

describe("workflow checks", () => {
  const wf = (over: Partial<WfInfo>): WfInfo => ({ name: "w", path: "C:\w\w.json", refImageCount: 0, isRunnable: true, missing: [], outputKind: "image", ...over });

  it("rejects a still workflow that cannot take the photo or cannot run", () => {
    expect(judgeImage(wf({ refImageCount: 0 }), "C:\w\w.json", true).level).toBe("bad");
    expect(judgeImage(wf({ refImageCount: 1 }), "C:\w\w.json", true).level).toBe("ok");
    expect(judgeImage(wf({ refImageCount: 0 }), "C:\w\w.json", false).level).toBe("ok");
    const broken = judgeImage(wf({ isRunnable: false, missing: ["incomplete workflow: node 31 points at node 57"] }), "C:\w\w.json", false);
    expect(broken.level).toBe("bad");
    expect(broken.text).toContain("incomplete workflow");
  });

  it("needs as many video slots as a scene has references", () => {
    expect(judgeVideo(wf({ refImageCount: 2 }), "p", 3).level).toBe("bad");
    expect(judgeVideo(wf({ refImageCount: 0 }), "p", 2).level).toBe("warn");
    expect(judgeImage(wf({ isRunnable: false, missing: ["UI-format workflow - start ComfyUI so this app can read it"] }), "p", true).level).toBe("warn");
    expect(judgeVideo(wf({ refImageCount: 3 }), "p", 3).level).toBe("ok");
    expect(judgeVideo(undefined, "", 1).level).toBe("bad");
  });

  it("suggests runnable workflows with enough slots, fewest slots first", () => {
    const list = [wf({ name: "a", refImageCount: 0 }), wf({ name: "b", refImageCount: 3 }), wf({ name: "c", refImageCount: 1 }), wf({ name: "d", refImageCount: 1, isRunnable: false })];
    expect(suggestions(list, "image", { photo: true }).map(w => w.name)).toEqual(["c", "b"]);
  });
});

describe("reference kinds", () => {
  it("tells the video model what each kind of picture is for", () => {
    const { project, episode, scene } = fixture();
    const mk = (id: string, name: string, kind: string, role: "style" | "character" = "character") => ({ id, name, role, kind, prompt: "", negative: "", seed: 1, file: "f.png", status: "done" as const, error: null });
    const ep = { ...episode, refs: [mk("a", "Richie", "person"), mk("b", "pink dress", "outfit"), mk("c", "the bag", "product"), mk("d", "cafe", "location"), mk("e", "sunset", "palette", "style")] };
    const prompt = buildScenePrompt(project, ep, { ...scene, refIds: ["a", "b", "c", "d", "e"] });
    expect(prompt).toContain("<Picture 1> as the exact appearance reference for Richie");
    expect(prompt).toContain('<Picture 2> as the outfit reference ("pink dress")');
    expect(prompt).toContain('<Picture 3> as the product reference ("the bag")');
    expect(prompt).toContain('<Picture 4> as the location reference ("cafe")');
    expect(prompt).toContain('<Picture 5> as the colour palette reference ("sunset")');
  });

  it("reads the kind of an older ref from its role, and orders photos person first", () => {
    expect(kindOf({ role: "style" })).toBe("style");
    expect(kindOf({ role: "character" })).toBe("person");
    expect(kindOf({ role: "character", kind: "bogus" })).toBe("person");
    const refs = [{ role: "style" as const, kind: "style" }, { role: "character" as const, kind: "outfit" }, { role: "character" as const }];
    expect([...refs].sort((a, b) => kindRank(a) - kindRank(b)).map(kindOf)).toEqual(["person", "outfit", "style"]);
  });
});

describe("several people", () => {
  const ref = (id: string, name: string, over: any = {}) => ({ id, name, role: "character" as const, kind: "person", prompt: "", negative: "", seed: 1, file: "x.png", status: "done" as const, error: null, ...over });
  const world = () => {
    const { project, episode, scene } = fixture();
    const ep = { ...episode, refs: [
      { ...ref("s", "style_plate", { role: "style", kind: "style", prompt: "a look", file: null, status: "pending" as const }) },
      ref("a1", "Ann photo", { person: "Ann" }), ref("a2", "Ann photo 2", { person: "Ann" }), ref("b1", "Bo photo", { person: "Bo" }),
    ], scenes: [{ ...scene, refIds: ["s"], cast: ["Ann", "Bo"] }, { ...scene, id: "s2", number: 2, refIds: ["s"], cast: ["Bo"] }] };
    return { ...project, episodes: [ep] } as Project;
  };

  it("finds the people and gives each a still made only from their own photos", () => {
    const p = world();
    expect(peopleOf(p).map(x => x.name)).toEqual(["Ann", "Bo"]);
    const eps = ensureCast({ ...p, stillPeople: ["Ann", "Bo"] } as Project);
    const stills = eps[0].refs.filter(r => r.prompt && r.kind === "person");
    expect(stills.map(r => r.person)).toEqual(["Ann", "Bo"]);
    expect(stills[0].fromRefIds).toEqual(["a1", "a2"]);
    expect(stills[1].fromRefIds).toEqual(["b1"]);
  });

  it("puts a scene's cast in its picture list, style first, and leaves out the people who are not in it", () => {
    const eps = ensureCast({ ...world(), stillPeople: ["Ann", "Bo"] } as Project);
    const names = (i: number) => eps[0].scenes[i].refIds.map(id => eps[0].refs.find(r => r.id === id)!.name);
    expect(names(0)).toEqual(["style_plate", "Ann", "Bo"]);
    expect(names(1)).toEqual(["style_plate", "Bo"]);
  });

  it("uses a person's own photo as it is unless a generated picture was asked for, and drops a picture the planner invented for them", () => {
    const w = world();
    const invented = { id: "inv", name: "Ann", role: "character" as const, kind: "person", prompt: "a woman", negative: "", seed: 1, file: null, status: "pending" as const, error: null };
    const ep = { ...w.episodes[0], refs: [...w.episodes[0].refs, invented] };
    ep.scenes = ep.scenes.map(sc => ({ ...sc, refIds: ["s", "inv"] }));
    const eps = ensureCast({ ...w, episodes: [ep] } as Project);
    expect(eps[0].refs.filter(r => r.prompt && r.kind === "person").length).toBe(1);
    const names = eps[0].scenes[0].refIds.map(id => eps[0].refs.find(r => r.id === id)!.name);
    expect(names).toEqual(["style_plate", "Ann photo", "Bo photo"]);
  });

  it("says who is who when two people share a shot, and leaves skipped pictures out", () => {
    const eps = ensureCast({ ...world(), stillPeople: ["Ann", "Bo"] } as Project);
    const project = { ...world(), episodes: eps } as Project;
    const prompt = buildScenePrompt(project as unknown as Project, eps[0] as any, eps[0].scenes[0] as any);
    expect(prompt).toContain("2 different people");
    expect(prompt).toContain("is Ann");
    const skipped = { ...project, episodes: [{ ...eps[0], refs: eps[0].refs.map(r => (r.person === "Bo" ? { ...r, skip: true } : r)) }] } as Project;
    expect(buildScenePrompt(skipped as unknown as Project, skipped.episodes[0] as any, skipped.episodes[0].scenes[0] as any)).not.toContain("is Bo");
  });

  it("finds a person's name in a shot as a whole word, one word or several", () => {
    expect(mentions("Richie walks into the cafe.", "Richie")).toBe(true);
    expect(mentions("Aunt May waves.", "aunt may")).toBe(true);
    expect(mentions("A richest man.", "Rich")).toBe(false);
    expect(mentions("Anything", "")).toBe(false);
  });

  it("tells the model which picture a single named person is, using the person's name rather than the file label", () => {
    const w = world();
    const ep = { ...w.episodes[0], refs: w.episodes[0].refs.filter(r => r.id !== "a2" && r.id !== "b1"), scenes: [{ ...w.episodes[0].scenes[0], refIds: ["s", "a1"] }] };
    const prompt = buildScenePrompt({ ...w, episodes: [ep] } as unknown as Project, ep as any, ep.scenes[0] as any);
    expect(prompt).toContain("Ann in the description below is the person in <Picture 2>");
    expect(prompt).toContain("for Ann");
    expect(prompt).not.toContain("Ann photo");
  });

  it("renames and skips everywhere, and fills workflow slots without ever passing a blank to a slot that cannot be skipped", () => {
    const p = world();
    expect(renamePerson(p, "Ann", "Anna")[0].scenes[0].cast).toEqual(["Anna", "Bo"]);
    expect(setSkip(p, p.episodes[0].refs[1], true)[0].refs[1].skip).toBe(true);
    expect(fillSlots(["a.png"], [false, true, false], 3)).toEqual(["a.png", "", "a.png"]);
    expect(fillSlots([], [false, false], 2)).toEqual(["", ""]);
    expect(fillSlots(["a", "b", "c"], [], 2)).toEqual(["a", "b"]);
  });

  it("drops a character the planner made for someone who already has a photo, and gives the photo that name", () => {
    const w = world();
    const photo = { ...w.episodes[0].refs.find(r => r.id === "b1")!, id: "ph", name: "my photo", person: undefined };
    const made = { id: "mk", name: "Richie", role: "character" as const, kind: "person", prompt: "a young woman", negative: "", seed: 1, file: null, status: "pending" as const, error: null };
    const ep = { ...w.episodes[0], refs: [w.episodes[0].refs[0], photo, made], scenes: [{ ...w.episodes[0].scenes[0], cast: [], refIds: ["s", "mk"] }] };
    const out = adoptPlannedPeople({ ...w, episodes: [ep] } as Project)[0];
    expect(out.refs.some(r => r.id === "mk")).toBe(false);
    expect(out.refs.find(r => r.id === "ph")!.person).toBe("Richie");
    expect(out.scenes[0].cast).toEqual(["Richie"]);
    expect(out.scenes[0].refIds).toEqual(["s"]);
    // two planned characters and one unnamed photo: nothing can be matched, so nothing is dropped
    const two = { ...ep, refs: [...ep.refs, { ...made, id: "mk2", name: "Bo2" }] };
    expect(adoptPlannedPeople({ ...w, episodes: [two] } as Project)[0].refs.length).toBe(4);
  });

  it("keeps another person's photo out of a person's still", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refs-"));
    const f = (n: string) => { const file = path.join(dir, n); fs.writeFileSync(file, "x"); return file; };
    const ep = { ...fixture().episode, refs: [
      ref("a1", "Ann photo", { person: "Ann", file: f("a.png") }), ref("b1", "Bo photo", { person: "Bo", file: f("b.png") }),
      ref("o1", "dress", { kind: "outfit", file: f("o.png") }),
      ref("st", "Ann still", { person: "Ann", prompt: "x", file: null }),
    ] };
    const files = refSourceFiles(ep as any, ep.refs[3] as any).map(x => path.basename(x));
    expect(files).toEqual(["a.png", "o.png"]);
  });
});

describe("video styles", () => {
  it("has a complete, unique, grouped style list including the outfit change", () => {
    const ids = SERIES_FORMATS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["outfit-change", "street-walk", "grwm", "fashion", "product-demo", "pov", "skit", "transformation", "travel", "asmr"]));
    for (const f of SERIES_FORMATS) {
      expect(f.group, f.id).toBeTruthy();
      expect(f.plan, f.id).toBeTruthy();
      expect(f.shotExample, f.id).toBeTruthy();
      expect(f.lineWords, f.id).toMatch(/^\d+-\d+$/);
    }
  });

  it("silences or voices any style with the voice switch, keeping the clips clean for your own music", () => {
    expect(projectFormat({ format: "street-walk" }).speech).toBe("oncamera");
    const off = projectFormat({ format: "street-walk", voice: "off" });
    expect(off.speech).toBe("none");
    expect(off.music).toBe("N/A");
    const on = projectFormat({ format: "outfit-change", voice: "on" });
    expect(on.speech).toBe("oncamera");
    expect(on.plan).toContain("talks to the camera");
    expect(projectFormat({ format: "outfit-change" }).speech).toBe("none");
    expect(projectFormat({ format: "singing", voice: "off" }).music).toBe("N/A");
  });

  it("words an outfit-change clip without speech and a talking one with it", () => {
    const { project, episode, scene } = fixture();
    const silent = buildScenePrompt({ ...project, format: "outfit-change" }, episode, scene);
    expect(silent).toContain("Nobody speaks");
    expect(silent).not.toContain("<d>");
    const talking = buildScenePrompt({ ...project, format: "outfit-change", voice: "on" }, episode, scene);
    expect(talking).toContain("<d>[English]");
    expect(buildScenePrompt({ ...project, format: "skit" }, episode, scene)).toContain("talk to each other");
  });
});

describe("planner model rating", () => {
  const m = (id: string, extra: any = {}) => ({ id, name: id, isDownloaded: true, source: "ollama", type: "General", tags: [], ...extra });

  it("reads the size from the name, or from the file size when the name has none", () => {
    expect(paramsFromName("qwen2.5:7b")).toBe(7);
    expect(paramsFromName("qwen3-coder:30b")).toBe(30);
    expect(paramsFromName("llama-3.3-70b-instruct")).toBe(70);
    expect(paramsFromName("deepseek-v3.1:671b-cloud")).toBe(671);
    expect(paramsFromName("phi4:latest")).toBeNull();
    expect(rateModel(m("llama3.2:latest", { sizeBytes: 2e9 }) as any).params).toBe(3);
  });

  it("rates small models weak or basic and big or online ones strong", () => {
    expect(rateModel(m("llama3.2:latest", { sizeBytes: 2e9 }) as any).tier).toBe("weak");
    expect(rateModel(m("qwen2.5:7b") as any).tier).toBe("basic");
    expect(rateModel(m("gpt-oss:20b") as any).tier).toBe("good");
    expect(rateModel(m("qwen3-coder:30b") as any).tier).toBe("strong");
    expect(rateModel(m("kimi-k2.6:cloud") as any).tier).toBe("strong");
    expect(rateModel(m("online:openai:gpt-4o", { source: "online", tags: ["Cloud"] }) as any).online).toBe(true);
  });

  it("marks a model down after it needed retries here", () => {
    const base = m("qwen3:14b") as any;
    expect(rateModel(base).tier).toBe("good");
    expect(rateModel(base, { ok: 0, struggled: 2, failed: 0 }).tier).toBe("basic");
    expect(rateModel(base, { ok: 5, struggled: 2, failed: 0 }).tier).toBe("good");
  });

  it("recommends the best offline model and, separately, the best online one", () => {
    const list = [m("qwen2.5:7b"), m("gpt-oss:20b"), m("qwen3:14b"), m("nomic-embed-text:latest"), m("llava:latest", { type: "Vision" }), m("kimi-k2.6:cloud"), m("online:xai:grok-4", { source: "online", tags: ["Cloud"] })] as any[];
    const r = recommend(list);
    expect(["gpt-oss:20b", "qwen3:14b"]).toContain(r.offline!.id);
    expect(r.offline!.id).toBe("qwen3:14b");
    expect(["kimi-k2.6:cloud", "online:xai:grok-4"]).toContain(r.online!.id);
  });
});

describe("planner picker choices", () => {
  it("leaves out models that cannot write a plan, and prefers a served model over a raw file", () => {
    expect(isChatModel({ id: "nomic-embed-text:latest", name: "nomic-embed-text:latest", type: "General" } as any)).toBe(false);
    expect(isChatModel({ id: "llava:latest", name: "llava:latest", type: "General" } as any)).toBe(false);
    expect(isChatModel({ id: "qwen3:8b", name: "qwen3:8b", type: "General" } as any)).toBe(true);
    const file = { id: "qwen3-coder-30b", name: "qwen3-coder-30b", isDownloaded: true, source: "gguf", type: "General", tags: [] };
    const served = { id: "ollama:qwen3-coder:30b", name: "qwen3-coder:30b", isDownloaded: true, source: "ollama", type: "General", tags: [] };
    expect(recommend([file, served] as any).offline!.id).toBe("ollama:qwen3-coder:30b");
  });
});
