/** Pure helpers for an episode's finishing: the audio mix as an ffmpeg filter graph, and the list of output versions. */

export interface AudioTrack {
  id: string;
  name: string;
  /** Converted copy inside the project (aac in an .m4a). */
  file: string;
  duration: number;
  /** Seconds into the episode where the track starts; negative skips the start of the track. */
  offset: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
}
export interface AudioMix { tracks: AudioTrack[]; keepOriginal: boolean; originalGain: number; updatedAt: string }

export type OutputKind = "joined" | "subtitled" | "audio" | "final";
export interface Output { kind: OutputKind; path: string; at: string }

const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const num = (v: any, fallback: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback; };

/** Keeps edited audio settings sane. */
export function cleanTracks(raw: any, prev: AudioTrack[]): AudioTrack[] {
  if (!Array.isArray(raw)) return prev;
  return raw.map((t: any) => {
    const old = prev.find(p => p.id === t?.id);
    if (!old) return null;
    return { ...old, name: String(t.name ?? old.name).slice(0, 120), offset: num(t.offset, old.offset, -600, 36000), gain: num(t.gain, old.gain, 0, 4), fadeIn: num(t.fadeIn, old.fadeIn, 0, 60), fadeOut: num(t.fadeOut, old.fadeOut, 0, 60) };
  }).filter(Boolean) as AudioTrack[];
}

/**
 * Input 0 is the joined video (with its own sound); the tracks are inputs 1..n. Each track is trimmed or delayed to its offset,
 * given its gain and fades, and everything is summed (not averaged, so quiet tracks stay audible) and cut to the video's length.
 */
export function buildAudioFilter(mix: Pick<AudioMix, "tracks" | "keepOriginal" | "originalGain">, videoDuration: number, normalize = false): { filter: string; label: string } | null {
  const parts: string[] = [];
  const labels: string[] = [];
  if (mix.keepOriginal) { parts.push(`[0:a]volume=${n3(mix.originalGain)}[a0]`); labels.push("[a0]"); }
  mix.tracks.forEach((t, i) => {
    const idx = i + 1;
    const chain = [`aresample=48000`, `aformat=channel_layouts=stereo`];
    let effective = t.duration;
    if (t.offset < 0) { chain.push(`atrim=start=${n3(-t.offset)}`, `asetpts=PTS-STARTPTS`); effective = Math.max(0, t.duration + t.offset); }
    chain.push(`volume=${n3(t.gain)}`);
    if (t.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${n3(t.fadeIn)}`);
    if (t.fadeOut > 0) chain.push(`afade=t=out:st=${n3(Math.max(0, effective - t.fadeOut))}:d=${n3(t.fadeOut)}`);
    if (t.offset > 0) { const ms = Math.round(t.offset * 1000); chain.push(`adelay=${ms}|${ms}`); }
    parts.push(`[${idx}:a]${chain.join(",")}[t${idx}]`);
    labels.push(`[t${idx}]`);
  });
  if (!labels.length) return null;
  const cut = `atrim=duration=${n3(videoDuration)}`;
  parts.push(labels.length === 1
    ? `${labels[0]}${cut}[aout]`
    : `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0${normalize ? "" : ":normalize=0"},${cut}[aout]`);
  return { filter: parts.join(";"), label: "[aout]" };
}

/** Records (or replaces) the newest output of a kind. */
export function upsertOutput(outputs: Output[] | undefined, kind: OutputKind, path: string, at = new Date().toISOString()): Output[] {
  return [...(outputs || []).filter(o => o.kind !== kind), { kind, path, at }];
}

/** The version to use: the pinned one if it exists, otherwise the newest. */
export function pickFinal(joinedPath: string | null, outputs: Output[] | undefined, finalKind?: string | null): string | null {
  const list = (outputs || []).filter(o => o.path);
  const pinned = finalKind ? list.find(o => o.kind === finalKind) : null;
  if (pinned) return pinned.path;
  const newest = [...list].sort((a, b) => a.at.localeCompare(b.at)).pop();
  return newest ? newest.path : joinedPath;
}
