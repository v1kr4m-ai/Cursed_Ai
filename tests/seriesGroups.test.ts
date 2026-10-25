import { describe, expect, it } from "vitest";
import { applyGrouping, groupsOf, itemLabel } from "../src/components/tools/series/groups";

const eps = (n: number): any[] => Array.from({ length: n }, (_, i) => ({ id: "e" + (i + 1), number: i + 1, title: "t" + (i + 1), scenes: [], refs: [] }));

describe("episode groups", () => {
  it("makes weeks of seven days", () => {
    const g = { unit: "Week", item: "Day", size: 7 };
    const out = applyGrouping(eps(9), g);
    expect(out.map(e => e.group)).toEqual([...Array(7).fill("Week 1"), "Week 2", "Week 2"]);
    const project: any = { grouping: g, episodes: out };
    expect(itemLabel(project, out[0])).toBe("Day 1");
    expect(itemLabel(project, out[8])).toBe("Day 2");
  });

  it("keeps hand-made groups (storylines) in the order they first appear", () => {
    const list = eps(4).map((e, i) => ({ ...e, group: ["Richie", "Ann", "Richie", ""][i] }));
    expect(groupsOf(list).map(g => [g.name, g.episodes.length])).toEqual([["Richie", 2], ["Ann", 1], ["", 1]]);
    expect(itemLabel({ episodes: list } as any, list[0])).toBe("");
  });
});
