import { describe, expect, it } from "vitest";
import { buildScenePrompt, snapFrames, type Episode, type Project, type Scene } from "../seriesTool/model";
import { buildFilter } from "../seriesTool/ffmpeg";
import { extractJson } from "../src/components/tools/series/api";
import { planProblems, tidyPlan } from "../src/components/tools/series/planCheck";
import { judgeImage, judgeVideo, suggestions, type WfInfo } from "../src/components/tools/series/workflows";
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
