import type { SeriesFormat } from "../../../../seriesTool/formats";

/** The names of the people in a scene, from whichever key the model used. */
const castOf = (sc: any): string[] => { const v = sc?.cast ?? sc?.characters ?? sc?.people ?? sc?.persons; return Array.isArray(v) ? v.map((x: any) => String(typeof x === "object" ? x?.name : x).trim()).filter(Boolean) : typeof v === "string" && v.trim() ? v.split(/[,&]/).map(x => x.trim()).filter(Boolean) : []; };

/** Models name fields differently; map the usual alternatives onto the ones the plan uses. */
export function tidyPlan(plan: any): any {
  const pick = (o: any, keys: string[]) => keys.map(k => o?.[k]).find(v => typeof v === "string" && v.trim()) || "";
  const fixEpisode = (e: any) => {
    if (!e || typeof e !== "object") return e;
    if (Array.isArray(e.scenes)) e.scenes = e.scenes.map((sc: any) => ({ ...sc, cast: castOf(sc), shot: pick(sc, ["shot", "visual", "visuals", "camera", "action", "description", "scene"]), vo: pick(sc, ["vo", "line", "lines", "dialogue", "narration", "script", "lyric", "caption"]) }));
    return e;
  };
  return Array.isArray(plan) ? plan.map(fixEpisode) : fixEpisode(plan);
}

/** What is wrong with a plan, in words the model can act on; empty when it is usable. */
export function planProblems(plan: any, fmt: SeriesFormat, people: string[] = []): string {
  const eps = Array.isArray(plan) ? plan : [plan];
  const noShot: string[] = [], noLine: string[] = [], same: string[] = [], noCast: string[] = [];
  for (const e of eps) for (const sc of e?.scenes || []) {
    const where = `episode ${e.number ?? "?"} scene ${sc.number ?? "?"}`;
    if (!String(sc.shot || "").trim()) noShot.push(where);
    if (fmt.speech !== "none" && !String(sc.vo || "").trim()) noLine.push(where);
    if (people.length && !(Array.isArray(sc.cast) && sc.cast.length)) noCast.push(where);
    if (sc.shot && sc.vo && String(sc.shot).trim() === String(sc.vo).trim()) same.push(where);
  }
  const out: string[] = [];
  if (noShot.length) out.push(`These scenes have an empty "shot": ${noShot.slice(0, 6).join(", ")}${noShot.length > 6 ? " and more" : ""}. Every scene needs a specific shot, for example: ${fmt.shotExample}`);
  if (noLine.length) out.push(`These scenes have an empty "vo": ${noLine.slice(0, 6).join(", ")}.`);
  if (noCast.length) out.push(`These scenes have no "cast" (the names of the people in the scene, from: ${people.join(", ")}): ${noCast.slice(0, 6).join(", ")}.`);
  if (same.length) out.push(`The "shot" and "vo" are identical in: ${same.slice(0, 6).join(", ")}.`);
  return out.join(" ");
}
