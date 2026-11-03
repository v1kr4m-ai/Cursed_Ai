import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny in-memory series behind the client api, so syncPhotos runs as it does in the page.
let project: any;
vi.mock("../src/components/tools/series/api", () => ({
  fileUrl: (p: string) => p,
  api: {
    get: async () => structuredClone(project),
    patch: async (_id: string, body: any) => { project = { ...project, ...structuredClone(body) }; return structuredClone(project); },
    uploadRef: async (_id: string, episodeId: string, file: File, label: string, role: string, kind?: string, person?: string) => {
      const ep = project.episodes.find((e: any) => e.id === episodeId);
      const ref = { id: "copy-" + episodeId, name: label, role, kind, person, prompt: "", negative: "", seed: 1, file: "/f/" + file.name, status: "done", error: null };
      ep.refs.push(ref);
      return { ref };
    },
  },
}));
const { syncPhotos } = await import("../src/components/tools/series/photos");

const scene = (id: string, vo: string, refIds: string[], cast?: string[]) => ({ id, number: 1, vo, shot: "", textCard: "", refIds, cast, seed: 1, promptText: "", promptEdited: false, status: "pending", clipPath: null, durationS: null, promptId: null, error: null });

beforeEach(() => {
  (globalThis as any).fetch = async () => ({ blob: async () => new Blob(["x"], { type: "image/png" }) });
  project = {
    id: "p",
    episodes: [
      { id: "e1", refs: [{ id: "photo", name: "Meera", role: "character", kind: "person", person: "Meera", prompt: "", file: "/f/meera.png", status: "done" }], scenes: [scene("s1", "Meera waves", ["photo"])] },
      { id: "e2", refs: [
        { id: "gen", name: "Meera", role: "character", kind: "person", person: "Meera", prompt: "a woman, studio light", file: null, status: "pending" },
        { id: "arjun", name: "Arjun", role: "character", kind: "person", person: "Arjun", prompt: "", file: "/f/arjun.png", status: "done" },
      ], scenes: [scene("s2", "Meera talks to Arjun", ["gen", "arjun"]), scene("s3", "Arjun alone at the desk", ["arjun"]), scene("s4", "The city at night", [])] },
    ],
  };
});

describe("syncPhotos", () => {
  it("puts a photo in place of the made-to-order picture of the same person in every episode, and ticks it where it belongs", async () => {
    const { project: out } = await syncPhotos(project);
    const e2 = out.episodes[1];
    expect(e2.refs.map((r: any) => r.id).sort()).toEqual(["arjun", "copy-e2"]); // the ComfyUI picture gave way
    const ids = (s: string) => e2.scenes.find((x: any) => x.id === s).refIds;
    expect(ids("s2")).toEqual(["copy-e2", "arjun"]); // swapped in place
    expect(ids("s3")).toEqual(["arjun"]);            // Meera is not in it
    expect(ids("s4")).toEqual(["arjun", "copy-e2"]); // no character picture yet: gets the people
  });

  it("keeps within the workflow's picture slots", async () => {
    project.episodes[1].scenes[1] = scene("s3", "Meera and Arjun argue", ["arjun"]);
    const { project: out } = await syncPhotos(project, [], 1);
    expect(out.episodes[1].scenes.find((x: any) => x.id === "s3").refIds).toEqual(["arjun"]);
  });
});
