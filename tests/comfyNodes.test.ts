import { describe, expect, it } from "vitest";
import { packsFor } from "../comfyNodes";

describe("finding the pack for a missing node", () => {
  const mappings = {
    "https://github.com/a/reactor": [["ReActorFaceSwap", "ReActorSaveFace"], { title_aux: "ReActor" }],
    "https://github.com/b/tiles.git": [["TTP_Image_Assy"], { title_aux: "TTP", nodename_pattern: "^TTP_" }],
    "styles-pack": [["Load Styles CSV"], { title_aux: "Styles" }],
  };
  const packs = {
    "comfyui-reactor": { id: "comfyui-reactor", title: "ReActor", repository: "https://github.com/a/reactor", state: "not-installed" },
    "styles-pack": { id: "styles-pack", title: "Styles", repository: "https://github.com/c/styles", state: "not-installed" },
    "ttp-toolset": { id: "ttp-toolset", title: "TTP Toolset", files: ["https://github.com/b/tiles"], state: "enabled" },
  };

  it("finds packs by node name, by name pattern, and says which are installed", () => {
    const r = packsFor(["ReActorFaceSwap", "TTP_Image_Tile_Batch", "Nope"], mappings, packs);
    expect(r.ReActorFaceSwap.map(p => p.id)).toEqual(["comfyui-reactor"]);
    expect(r.ReActorFaceSwap[0].installed).toBe(false);
    expect(r.TTP_Image_Tile_Batch.map(p => [p.id, p.installed])).toEqual([["ttp-toolset", true]]);
    expect(r.Nope).toEqual([]);
    expect(packsFor(["Load Styles CSV"], mappings, packs)["Load Styles CSV"].map(p => p.id)).toEqual(["styles-pack"]);
  });
});
