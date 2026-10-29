import { describe, expect, it } from "vitest";
import { resolveEverywhere } from "../comfyTool/convert";

describe("Use Everywhere broadcast nodes", () => {
  it("wires every empty matching socket from what is plugged into the broadcast node", () => {
    const nodes: any[] = [
      { id: 1, type: "CheckpointLoaderSimple", outputs: [{ type: "MODEL" }, { type: "CLIP" }, { type: "VAE" }] },
      { id: 2, type: "CLIPTextEncode", outputs: [{ type: "CONDITIONING" }] },
      { id: 3, type: "ConditioningZeroOut", outputs: [{ type: "CONDITIONING" }] },
      { id: 10, type: "Anything Everywhere", inputs: [{ name: "anything", type: "*", link: null }] },
      { id: 11, type: "Prompts Everywhere", inputs: [] },
      { id: 20, type: "KSampler", inputs: [{ name: "model", type: "MODEL", link: null }, { name: "positive", type: "CONDITIONING", link: null }, { name: "negative", type: "CONDITIONING", link: null }, { name: "seed", type: "INT", link: null, widget: { name: "seed" } }] },
      { id: 21, type: "KSampler", mode: 4, inputs: [{ name: "model", type: "MODEL", link: null }] },
      { id: 22, type: "KSampler", inputs: [{ name: "model", type: "MODEL", link: 99 }] },
    ];
    const links: any[] = [[1, 1, 0, 10, 1, "MODEL"], [2, 2, 0, 11, 2, "CONDITIONING"], [3, 3, 0, 11, 3, "CONDITIONING"], [99, 1, 0, 22, 0, "MODEL"]];
    resolveEverywhere(nodes, links);
    const into = (id: number, name: string) => { const slot = nodes.find(n => n.id === id).inputs.find((s: any) => s.name === name); const l = links.find(x => x[0] === slot.link); return l ? l[1] : null; };
    expect(into(20, "model")).toBe(1);
    expect(into(20, "positive")).toBe(2);
    expect(into(20, "negative")).toBe(3);
    expect(into(20, "seed")).toBeNull();      // widgets are left alone
    expect(into(21, "model")).toBeNull();     // bypassed nodes too
    expect(into(22, "model")).toBe(1);        // already linked: unchanged
    expect(links.find(l => l[0] === nodes[7].inputs[0].link)[0]).toBe(99);
  });
});
