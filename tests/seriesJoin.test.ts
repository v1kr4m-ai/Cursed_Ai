import { describe, expect, it } from "vitest";
import { joinedEpisodes, movePath } from "../seriesTool/merge";
import { moveScene } from "../src/components/tools/series/EpisodeManager";

const ep = (n: number, dir: string): any => ({
  id: "e" + n, number: n, title: "Ep " + n, era: "", hookOut: "", exportPath: dir + "\\exports\\ep.mp4",
  refs: [
    { id: "r" + n, name: "style_plate", role: "style", prompt: "look", negative: "", seed: 1, file: dir + "\\refs\\style.png", status: "done", error: null },
    { id: "p" + n, name: "me", role: "character", kind: "person", person: "Me", prompt: "", negative: "", seed: 1, file: dir + "\\refs\\me.png", status: "done", error: null },
  ],
  scenes: [1, 2, 3].map(i => ({ id: `s${n}${i}`, number: i, vo: "v" + i, shot: "s" + i, refIds: ["r" + n, "p" + n], status: "done", clipPath: `${dir}\\clips\\${i}.mp4` })),
});

describe("joining two series", () => {
  it("points a copied file at its new home and leaves other paths alone", () => {
    expect(movePath("D:\\a\\src\\refs\\x.png", "D:\\a\\src", "D:\\a\\dst", "src")).toBe("D:\\a\\dst\\refs\\from-src\\x.png");
    expect(movePath("C:\\elsewhere\\x.png", "D:\\a\\src", "D:\\a\\dst", "src")).toBe("C:\\elsewhere\\x.png");
    expect(movePath("D:\\a\\src-two\\refs\\x.png", "D:\\a\\src", "D:\\a\\dst", "src")).toBe("D:\\a\\src-two\\refs\\x.png");
  });

  it("adds the episodes after the last one, with new ids and paths in this series", () => {
    const target: any = { dir: "D:\\a\\dst", episodes: [ep(1, "D:\\a\\dst"), ep(2, "D:\\a\\dst")] };
    const source: any = { dir: "D:\\a\\src", episodes: [ep(1, "D:\\a\\src")] };
    const [e] = joinedEpisodes(target, source, "src");
    expect(e.number).toBe(3);
    expect(e.id).not.toBe("e1");
    expect(e.scenes[0].clipPath).toBe("D:\\a\\dst\\clips\\from-src\\1.mp4");
    expect(e.refs[0].file).toBe("D:\\a\\dst\\refs\\from-src\\style.png");
    expect(e.scenes[0].refIds).toEqual(e.refs.map((r: any) => r.id));
    expect(e.refs.some((r: any) => r.id === "r1")).toBe(false);
  });
});

describe("reshuffling scenes", () => {
  const world = () => [ep(1, "D:\\a"), ep(2, "D:\\a")];
  const order = (eps: any[], i: number) => [...eps[i].scenes].sort((a: any, b: any) => a.number - b.number).map((s: any) => s.id);

  it("moves a scene within an episode and renumbers", () => {
    const eps = moveScene(world(), "e1", "s11", "e1", 2);
    expect(order(eps, 0)).toEqual(["s12", "s13", "s11"]);
    expect(eps[0].scenes.map((s: any) => s.number).sort()).toEqual([1, 2, 3]);
  });

  it("moves a scene to another episode with its clip, reusing pictures the other episode already has", () => {
    const eps: any[] = moveScene(world(), "e1", "s11", "e2", 0);
    expect(order(eps, 0)).toEqual(["s12", "s13"]);
    expect(order(eps, 1)).toEqual(["s11", "s21", "s22", "s23"]);
    const moved = eps[1].scenes.find((s: any) => s.id === "s11");
    expect(moved.clipPath).toBe("D:\\a\\clips\\1.mp4");
    expect(moved.refIds).toEqual(["r2", "p2"]);
    expect(eps[1].refs.length).toBe(2);
  });

  it("copies a picture the other episode does not have", () => {
    const w = world();
    w[0].refs.push({ id: "x", name: "cafe", role: "character", kind: "location", prompt: "", negative: "", seed: 1, file: "cafe.png", status: "done", error: null });
    w[0].scenes[0].refIds.push("x");
    const eps: any[] = moveScene(w, "e1", "s11", "e2", 99);
    expect(eps[1].refs.map((r: any) => r.name)).toEqual(["style_plate", "me", "cafe"]);
    expect(eps[1].refs[2].id).not.toBe("x");
    expect(order(eps, 1).at(-1)).toBe("s11");
  });
});
