import { describe, expect, it } from "vitest";
import { buildScenePrompt, snapFrames, type Episode, type Project, type Scene } from "../seriesTool/model";
import { buildFilter } from "../seriesTool/ffmpeg";
import { extractJson } from "../src/components/tools/series/api";

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
    styleLock: "STYLE_LOCK.", voiceLock: "a narrator (S1)", episodes: [episode],
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

  it("complains when there is no plan to find", () => {
    expect(() => extractJson("I could not do that.")).toThrow(/did not contain a usable plan/);
  });
});
