import { describe, expect, it } from "vitest";
import { buildAudioFilter, cleanTracks, pickFinal, upsertOutput, type AudioTrack } from "../seriesTool/finishCore";

const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({ id: "t1", name: "music", file: "m.m4a", duration: 30, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0, ...over });

describe("audio mix", () => {
  it("delays a track that starts later, fades it out relative to its own length, and sums with the original", () => {
    const r = buildAudioFilter({ tracks: [track({ offset: 2.5, gain: 0.5, fadeOut: 3 })], keepOriginal: true, originalGain: 0.8 }, 60)!;
    expect(r.filter).toContain("[0:a]volume=0.8[a0]");
    expect(r.filter).toContain("volume=0.5");
    expect(r.filter).toContain("afade=t=out:st=27:d=3");
    expect(r.filter).toContain("adelay=2500|2500");
    expect(r.filter).toContain("amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,atrim=duration=60[aout]");
  });

  it("skips the start of a track with a negative offset", () => {
    const r = buildAudioFilter({ tracks: [track({ offset: -4 })], keepOriginal: false, originalGain: 1 }, 20)!;
    expect(r.filter).toContain("atrim=start=4,asetpts=PTS-STARTPTS");
    expect(r.filter).not.toContain("adelay");
    expect(r.filter).toContain("[t1]atrim=duration=20[aout]");
  });

  it("has nothing to do without tracks or the original", () => {
    expect(buildAudioFilter({ tracks: [], keepOriginal: false, originalGain: 1 }, 10)).toBeNull();
  });

  it("clamps edited values and ignores unknown tracks", () => {
    const out = cleanTracks([{ id: "t1", offset: 99999, gain: -3, fadeIn: "x" }, { id: "nope" }], [track()]);
    expect(out).toHaveLength(1);
    expect(out[0].offset).toBe(36000);
    expect(out[0].gain).toBe(0);
    expect(out[0].fadeIn).toBe(0);
  });
});

describe("outputs", () => {
  it("keeps one output per kind and picks the pinned one, else the newest", () => {
    let o = upsertOutput(undefined, "subtitled", "a.mp4", "2026-01-01T00:00:00Z");
    o = upsertOutput(o, "final", "b.mp4", "2026-01-02T00:00:00Z");
    o = upsertOutput(o, "subtitled", "c.mp4", "2026-01-03T00:00:00Z");
    expect(o).toHaveLength(2);
    expect(pickFinal("joined.mp4", o)).toBe("c.mp4");
    expect(pickFinal("joined.mp4", o, "final")).toBe("b.mp4");
    expect(pickFinal("joined.mp4", undefined)).toBe("joined.mp4");
  });
});
