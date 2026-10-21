/** Pure helpers for episode subtitles: turning spoken words into timed cues, and cues + a look into an ASS file for ffmpeg. */

export interface Cue { id: string; start: number; end: number; text: string }

export interface SubStyle {
  font: string;
  /** Text height as a percent of the video height. */
  size: number;
  color: string;
  outlineColor: string;
  /** Outline thickness as a percent of the video height. */
  outlineWidth: number;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  position: "bottom" | "middle" | "top";
  box: boolean;
  boxOpacity: number;
  /** Most words shown at once. */
  maxWords: number;
}

export interface Subtitles { cues: Cue[]; style: SubStyle; source: "script" | "offline" | "online" | "manual"; outPath?: string; updatedAt: string }

export const DEFAULT_SUB_STYLE: SubStyle = {
  font: "Arial", size: 5.2, color: "#ffffff", outlineColor: "#000000", outlineWidth: 0.35,
  bold: true, italic: false, uppercase: false, position: "bottom", box: false, boxOpacity: 0.55, maxWords: 4,
};

/** Where speech starts and ends in mono samples: the first and last stretch clearly louder than the background. */
export function speechSpan(samples: Float32Array, rate = 16000): { start: number; end: number } {
  const win = Math.max(1, Math.round(rate * 0.02));
  const n = Math.floor(samples.length / win);
  const total = samples.length / rate;
  if (n < 3) return { start: 0, end: total };
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * win; j < (i + 1) * win; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / win));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = sorted[Math.floor(n * 0.1)];
  const peak = sorted[n - 1];
  if (peak < 0.004) return { start: 0, end: total };
  const thr = Math.max(noise * 3, peak * 0.12, 0.003);
  let first = rms.findIndex(v => v > thr), last = -1;
  for (let i = n - 1; i >= 0; i--) if (rms[i] > thr) { last = i; break; }
  if (first < 0 || last < first) return { start: 0, end: total };
  return { start: Math.max(0, first * 0.02 - 0.1), end: Math.min(total, (last + 1) * 0.02 + 0.15) };
}

/** Splits spoken text into short on-screen chunks, preferring to break after punctuation. */
export function chunkWords(text: string, maxWords: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= maxWords || (cur.length >= 2 && /[.,;:!?]$/.test(w))) { out.push(cur.join(" ")); cur = []; }
  }
  if (cur.length) {
    if (cur.length === 1 && out.length) out[out.length - 1] += " " + cur[0]; else out.push(cur.join(" "));
  }
  return out;
}

let counter = 0;
const cueId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Timed cues for one stretch of speech: each chunk gets time in proportion to its length. */
export function makeCues(text: string, start: number, end: number, maxWords: number): Cue[] {
  const chunks = chunkWords(text, maxWords);
  if (!chunks.length || end <= start) return [];
  const weights = chunks.map(c => Math.max(1, c.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return chunks.map((c, i) => {
    const d = ((end - start) * weights[i]) / sum;
    const cue = { id: cueId(), start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, text: c };
    t += d;
    return cue;
  });
}

const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); return m ? m[1] : "ffffff"; };
/** ASS colours are &HAABBGGRR (alpha 00 = opaque). */
export const assColor = (c: string, alpha = 0) => {
  const h = hex(c);
  return "&H" + alpha.toString(16).padStart(2, "0").toUpperCase() + (h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase();
};
const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

export function buildAss(cues: Cue[], style: SubStyle, width: number, height: number): string {
  const align = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const marginV = style.position === "middle" ? 0 : Math.round(height * 0.1);
  const size = Math.round((style.size / 100) * height);
  const outline = Math.max(0, Math.round((style.outlineWidth / 100) * height * 10) / 10);
  const backAlpha = Math.round((1 - Math.min(1, Math.max(0, style.boxOpacity))) * 255);
  const font = style.font.replace(/[,\r\n]/g, " ");
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,${font},${size},${assColor(style.color)},${assColor(style.color)},${assColor(style.outlineColor)},${assColor(style.box ? style.outlineColor : "#000000", style.box ? backAlpha : 255)},${style.bold ? -1 : 0},${style.italic ? -1 : 0},0,0,100,100,0,0,${style.box ? 3 : 1},${style.box ? Math.round(size * 0.25) : outline},0,${align},${Math.round(width * 0.06)},${Math.round(width * 0.06)},${marginV},1`,
    "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  for (const c of cues) {
    if (!c.text.trim() || c.end <= c.start) continue;
    const text = (style.uppercase ? c.text.toUpperCase() : c.text).replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
    lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${text}`);
  }
  return lines.join("\n") + "\n";
}

/** Keeps edited cues sane: numbers, ordering, no empty text. */
export function cleanCues(raw: any): Cue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => ({ id: String(c?.id || cueId()), start: Number(c?.start), end: Number(c?.end), text: String(c?.text ?? "") }))
    .filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
}

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
/** The cues as a standard .srt file (for uploading next to a video). */
export function buildSrt(cues: Cue[]): string {
  return cues.filter(c => c.text.trim() && c.end > c.start).map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text.trim()}\n`).join("\n");
}
