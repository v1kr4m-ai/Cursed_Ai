/**
 * Episodes gathered into groups: "Week 1" holding "Day 1..7", "Season 2", or one storyline per character.
 * An episode's group is just its `group` name. A series can also number them automatically: every `size`
 * episodes make the next group, and each episode inside is called by `item` ("Day 3").
 */
import type { Episode, Project } from "./api";

export interface Grouping { unit: string; item: string; size: number }

export const GROUPING_PRESETS: { label: string; g: Grouping }[] = [
  { label: "Weeks of 7 days", g: { unit: "Week", item: "Day", size: 7 } },
  { label: "Seasons of 10", g: { unit: "Season", item: "Episode", size: 10 } },
  { label: "Seasons of 6", g: { unit: "Season", item: "Episode", size: 6 } },
  { label: "Parts of 5", g: { unit: "Part", item: "Chapter", size: 5 } },
  { label: "Months of 4 weeks", g: { unit: "Month", item: "Week", size: 4 } },
];

/** Gives every episode, in order, its automatic group: episodes 1-7 "Week 1", 8-14 "Week 2"... */
export function applyGrouping(episodes: Episode[], g: Grouping): Episode[] {
  const size = Math.max(1, Math.floor(g.size) || 1);
  return [...episodes].sort((a, b) => a.number - b.number).map((e, i) => ({ ...e, group: `${g.unit.trim() || "Group"} ${Math.floor(i / size) + 1}` }));
}

/** The episodes in their groups, groups in the order they first appear. Episodes with no group come together under "". */
export function groupsOf(episodes: Episode[]): { name: string; episodes: Episode[] }[] {
  const out: { name: string; episodes: Episode[] }[] = [];
  for (const e of [...episodes].sort((a, b) => a.number - b.number)) {
    const name = (e.group || "").trim();
    let g = out.find(x => x.name === name);
    if (!g) { g = { name, episodes: [] }; out.push(g); }
    g.episodes.push(e);
  }
  return out;
}

/** How an episode is called inside its group, e.g. "Day 3" (empty when the series has no automatic grouping or the episode no group). */
export function itemLabel(project: Pick<Project, "grouping" | "episodes">, e: Episode): string {
  const g = project.grouping;
  if (!g?.item?.trim() || !e.group) return "";
  const same = [...project.episodes].filter(x => x.group === e.group).sort((a, b) => a.number - b.number);
  const i = same.findIndex(x => x.id === e.id);
  return i < 0 ? "" : `${g.item.trim()} ${i + 1}`;
}

/** Whether any episode is grouped (lists only show group headings then). */
export const hasGroups = (episodes: Episode[]) => episodes.some(e => (e.group || "").trim());
