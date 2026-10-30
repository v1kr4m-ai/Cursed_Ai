/**
 * Every render of a scene is kept: the first is ep01_scene02.mp4, re-renders get a time stamp
 * (ep01_scene02_20261025_154230.mp4). These are a scene's takes; the scene's clipPath is the one that gets joined.
 */
import fs from "fs";
import path from "path";

export interface Take { path: string; at: number }

const pad = (n: number) => String(n).padStart(2, "0");

/** The files in `dir` that are takes of this scene, oldest first. */
export function takesIn(dir: string, episode: number, scene: number): Take[] {
  const re = new RegExp(`^ep${pad(episode)}_scene${pad(scene)}(_\\d{8}_\\d{6}(_\\d+)?)?\\.mp4$`, "i");
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(n => re.test(n))
    .map(n => ({ path: path.join(dir, n), at: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Takes no scene uses: every take of a scene except the one it joins. Scenes with no chosen clip, or rendering
 * right now, and files of scenes that no longer exist are left alone - nothing here can tell what matters there.
 */
export function unusedTakes(dir: string, episodes: { number: number; scenes: { number: number; clipPath: string | null; status?: string }[] }[]): Take[] {
  const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  return episodes.flatMap(e => e.scenes.filter(s => s.clipPath && s.status !== "running" && s.status !== "queued")
    .flatMap(s => takesIn(dir, e.number, s.number).filter(t => !same(t.path, s.clipPath!))));
}
