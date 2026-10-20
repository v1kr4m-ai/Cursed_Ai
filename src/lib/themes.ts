/**
 * Colour themes. Every theme defines the same set of CSS variables; `scripts/gen-themes.ts` turns them into
 * `src/styles/themes.generated.css`, which also remaps the app's utility classes (text-zinc-400, bg-white/5, text-violet-400 ...)
 * to those variables - so a theme can be applied to the whole page, or to a single module, with one `data-theme` attribute.
 * "classic" is the original look (its values are exactly what the utility classes already produced).
 */

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  mode: "dark" | "light";
  /** Colours shown on the picker card. */
  swatch: [string, string, string];
  vars: ThemeVars;
}

/** Zinc scale steps used by the app: 100 200 300 400 500 600 700 800 900 950 (100 = strongest text, 950 = deepest surface in dark themes; reversed in light ones). */
type Ramp = [string, string, string, string, string, string, string, string, string, string];
/** Accent scale steps: 100 200 300 400 500 600 700 800 900 950. */
type AccentRamp = Ramp;

export interface ThemeVars {
  bg: string;        // page base colour
  page: string;      // page backdrop (gradient)
  atmo: string;      // soft glow layer over the page
  text: string;      // body text
  ink: string;       // strongest text (replaces text-white)
  ov: string;        // overlay colour (replaces white in bg-white/5, border-white/10 ...)
  black: string;     // replaces bg-black
  z: Ramp;
  v: AccentRamp;
  onAccent: string;  // text on accent-coloured buttons
  glass: string;
  glassBorder: string;
  userBubble: string;
  userBubbleInk: string;
  radius: string;    // corner feel (cards)
}

const CLASSIC_Z: Ramp = ["oklch(96.7% .001 286.375)", "oklch(92% .004 286.32)", "oklch(87.1% .006 286.286)", "oklch(70.5% .015 286.067)", "oklch(55.2% .016 285.938)", "oklch(44.2% .017 285.786)", "oklch(37% .013 285.805)", "oklch(27.4% .006 286.033)", "oklch(21% .006 285.885)", "oklch(14.1% .005 285.823)"];
const CLASSIC_V: AccentRamp = ["oklch(94.3% .029 294.588)", "oklch(89.4% .057 293.283)", "oklch(81.1% .111 293.571)", "#c084fc", "#8b5cf6", "#7c3aed", "oklch(49.1% .27 292.581)", "oklch(43.2% .232 292.759)", "#4c1d95", "oklch(28.3% .141 291.089)"];

export const THEMES: Theme[] = [
  {
    id: "classic", name: "Classic", blurb: "The original look - near-black with violet.", mode: "dark", swatch: ["#050505", "#7c3aed", "#c084fc"],
    vars: {
      bg: "#050505", page: "none", atmo: "none",
      text: "#e5e5e5", ink: "#ffffff", ov: "#ffffff", black: "#000000", z: CLASSIC_Z, v: CLASSIC_V, onAccent: "#ffffff",
      glass: "rgba(255,255,255,0.03)", glassBorder: "rgba(255,255,255,0.08)", userBubble: "#4c1d95", userBubbleInk: "#ffffff", radius: "1.5rem",
    },
  },
  {
    id: "ember", name: "Ember", blurb: "Charcoal panels with a hot red accent.", mode: "dark", swatch: ["#1b1818", "#d93a3a", "#ff746e"],
    vars: {
      bg: "#121010", page: "linear-gradient(135deg,#0d0c0c 0%,#171212 55%,#2a1514 100%)",
      atmo: "radial-gradient(circle at 88% 92%, rgba(200,50,45,.30) 0%, transparent 46%), radial-gradient(circle at 8% 8%, rgba(255,255,255,.04) 0%, transparent 40%)",
      text: "#e9e5e5", ink: "#ffffff", ov: "#ffffff", black: "#0a0909",
      z: ["#f3f0f0", "#e1dcdc", "#c9c3c3", "#9d9696", "#776f6f", "#564f4f", "#3e3838", "#2d2828", "#221e1e", "#171414"],
      v: ["#ffe3e0", "#ffc8c3", "#ffa099", "#ff776f", "#f0524f", "#d93a3a", "#b32d32", "#8a2328", "#5e1a1f", "#3a1013"],
      onAccent: "#ffffff", glass: "rgba(255,255,255,0.045)", glassBorder: "rgba(255,255,255,0.09)", userBubble: "#b32d32", userBubbleInk: "#ffffff", radius: "1.6rem",
    },
  },
  {
    id: "gilded", name: "Gilded", blurb: "Warm black with brushed-gold highlights.", mode: "dark", swatch: ["#17140f", "#d68f2f", "#f5cf93"],
    vars: {
      bg: "#100e0b", page: "linear-gradient(160deg,#0c0b09 0%,#16130f 60%,#211b12 100%)",
      atmo: "radial-gradient(circle at 15% 85%, rgba(214,143,47,.22) 0%, transparent 42%), radial-gradient(circle at 85% 10%, rgba(255,214,150,.07) 0%, transparent 40%)",
      text: "#ece6da", ink: "#fffaf0", ov: "#fff3dc", black: "#080705",
      z: ["#f6f0e4", "#e6dcc8", "#d0c3a8", "#a69878", "#7e725a", "#5b5240", "#413a2d", "#2f2a21", "#231f18", "#171410"],
      v: ["#fdf0d6", "#fbe0b0", "#f6c97f", "#efb25a", "#e59d3c", "#d68f2f", "#b07325", "#85561c", "#573812", "#33200a"],
      onAccent: "#1a1206", glass: "rgba(255,243,220,0.045)", glassBorder: "rgba(255,225,170,0.12)", userBubble: "#b07325", userBubbleInk: "#fffaf0", radius: "1.4rem",
    },
  },
  {
    id: "midnight", name: "Midnight", blurb: "Deep navy and teal with an orange glow.", mode: "dark", swatch: ["#0b1621", "#f27f1d", "#2ea6b0"],
    vars: {
      bg: "#0a1520", page: "linear-gradient(160deg,#081019 0%,#0d1d2c 60%,#10283a 100%)",
      atmo: "radial-gradient(circle at 80% 15%, rgba(242,127,29,.22) 0%, transparent 42%), radial-gradient(circle at 10% 90%, rgba(46,166,176,.22) 0%, transparent 46%)",
      text: "#dce7f0", ink: "#f7fbff", ov: "#cfe6ff", black: "#050c13",
      z: ["#f2f7fb", "#e0ebf4", "#c4d6e5", "#93abc0", "#6b8499", "#4b6275", "#354a5c", "#25384a", "#182a3a", "#0e1c29"],
      v: ["#ffe6cc", "#ffd0a3", "#ffb673", "#ffa04d", "#ff8d2e", "#f27f1d", "#cf6511", "#9d4c0e", "#6a330a", "#3d1d06"],
      onAccent: "#1a0d02", glass: "rgba(207,230,255,0.05)", glassBorder: "rgba(207,230,255,0.11)", userBubble: "#cf6511", userBubbleInk: "#fff7ef", radius: "1.5rem",
    },
  },
  {
    id: "dusk", name: "Dusk", blurb: "Plum and charcoal with a peach sunset.", mode: "dark", swatch: ["#221c2b", "#ec6a48", "#ff9a7c"],
    vars: {
      bg: "#17121e", page: "linear-gradient(165deg,#120e18 0%,#221a2d 55%,#33223a 100%)",
      atmo: "radial-gradient(circle at 75% 20%, rgba(255,154,124,.26) 0%, transparent 40%), radial-gradient(circle at 15% 80%, rgba(140,90,190,.20) 0%, transparent 46%)",
      text: "#eadfe6", ink: "#fffaf8", ov: "#ffe9e2", black: "#0d0a12",
      z: ["#f8f0f3", "#eadbe3", "#d3bfcc", "#a98fa8", "#80698a", "#5e4d6b", "#463a54", "#352c42", "#292233", "#1c1726"],
      v: ["#ffe4da", "#ffcab8", "#ffae96", "#ff9377", "#f9805f", "#ec6a48", "#c8523a", "#99402e", "#682b20", "#3c1912"],
      onAccent: "#2a0f08", glass: "rgba(255,233,226,0.05)", glassBorder: "rgba(255,233,226,0.11)", userBubble: "#c8523a", userBubbleInk: "#fff5f1", radius: "1.7rem",
    },
  },
  {
    id: "frost", name: "Frost", blurb: "Translucent dark glass with a sky-blue accent.", mode: "dark", swatch: ["#2a2e35", "#3da5f5", "#8cd0ff"],
    vars: {
      bg: "#14171c", page: "linear-gradient(150deg,#101317 0%,#1b2129 60%,#232b36 100%)",
      atmo: "radial-gradient(circle at 70% 25%, rgba(61,165,245,.22) 0%, transparent 42%), radial-gradient(circle at 15% 80%, rgba(255,255,255,.06) 0%, transparent 46%)",
      text: "#e6ebf0", ink: "#ffffff", ov: "#ffffff", black: "#0a0c0f",
      z: ["#f3f6f9", "#e1e7ed", "#c7d0d9", "#97a3b0", "#718090", "#505d6b", "#3a4552", "#2a333e", "#1f262f", "#151a21"],
      v: ["#e0f2ff", "#bde3ff", "#8fcfff", "#5dbbfb", "#3da5f5", "#2389dd", "#1a6dB5", "#13508a", "#0d3558", "#071e33"],
      onAccent: "#04121f", glass: "rgba(255,255,255,0.07)", glassBorder: "rgba(255,255,255,0.14)", userBubble: "#1a6db5", userBubbleInk: "#ffffff", radius: "1.8rem",
    },
  },
  {
    id: "indigo", name: "Indigo Light", blurb: "Clean white with indigo accents and navy ink.", mode: "light", swatch: ["#f4f5fb", "#4a38e6", "#14153a"],
    vars: {
      bg: "#eef0f8", page: "linear-gradient(180deg,#f6f7fc 0%,#eceef9 100%)",
      atmo: "radial-gradient(circle at 85% 10%, rgba(91,75,255,.10) 0%, transparent 42%), radial-gradient(circle at 10% 90%, rgba(120,140,255,.10) 0%, transparent 46%)",
      text: "#23264a", ink: "#14153a", ov: "#1d2150", black: "#14153a",
      z: ["#15173a", "#262a52", "#3d4270", "#656a92", "#8a8fb0", "#aeb2cc", "#cfd2e4", "#e3e5f1", "#eff0f8", "#f7f8fd"],
      v: ["#e4e0ff", "#cfc8ff", "#a79cff", "#6a5bff", "#5646f2", "#4a38e6", "#3d2fc4", "#2f2496", "#221a6b", "#150f43"],
      onAccent: "#ffffff", glass: "rgba(255,255,255,0.8)", glassBorder: "rgba(40,45,110,0.08)", userBubble: "#4a38e6", userBubbleInk: "#ffffff", radius: "1.4rem",
    },
  },
  {
    id: "aurora", name: "Aurora", blurb: "White cards floating on a violet-to-teal gradient.", mode: "light", swatch: ["#6a4fc9", "#5b3fd1", "#22b8a8"],
    vars: {
      bg: "#6f56c8", page: "linear-gradient(135deg,#1fb59c 0%,#6a52c4 45%,#a1558f 100%)",
      atmo: "radial-gradient(circle at 15% 15%, rgba(255,255,255,.18) 0%, transparent 38%), radial-gradient(circle at 90% 85%, rgba(255,160,90,.25) 0%, transparent 42%)",
      text: "#2b2556", ink: "#1b1640", ov: "#2b2070", black: "#1b1640",
      z: ["#1d1745", "#2e2860", "#473f7e", "#6e6697", "#938bb5", "#b6afd0", "#d6d1e6", "#e8e5f2", "#f2f0f9", "#faf9fd"],
      v: ["#e8e1ff", "#d3c7ff", "#b19eff", "#8062f0", "#6a48e0", "#5b3fd1", "#4a31b0", "#382689", "#271a60", "#170f3a"],
      onAccent: "#ffffff", glass: "rgba(255,255,255,0.82)", glassBorder: "rgba(255,255,255,0.7)", userBubble: "#5b3fd1", userBubbleInk: "#ffffff", radius: "1.7rem",
    },
  },
  {
    id: "glass", name: "Mono Glass", blurb: "Frosted white glass, charcoal cards, airy backdrop.", mode: "light", swatch: ["#e6e9ed", "#34363c", "#ffffff"],
    vars: {
      bg: "#dfe3e8", page: "linear-gradient(180deg,#eceff2 0%,#dde1e6 55%,#cdd2d8 100%)",
      atmo: "radial-gradient(900px 500px at 78% -8%, rgba(255,255,255,.9) 0%, transparent 60%), radial-gradient(700px 500px at 8% 40%, rgba(255,255,255,.6) 0%, transparent 62%)",
      text: "#25282d", ink: "#16171a", ov: "#1c1e22", black: "#16171a",
      z: ["#16171a", "#26292e", "#40444b", "#666b73", "#8a9097", "#aeb3b9", "#cdd1d6", "#e2e5e9", "#eff1f4", "#f7f8fa"],
      v: ["#e7e9ec", "#d1d4d9", "#9aa0a8", "#565b63", "#3f434a", "#2c2f35", "#202226", "#17181b", "#0f1012", "#08080a"],
      onAccent: "#ffffff", glass: "rgba(255,255,255,0.6)", glassBorder: "rgba(255,255,255,0.8)", userBubble: "#2c2f35", userBubbleInk: "#ffffff", radius: "1.8rem",
    },
  },
  {
    id: "sunlit", name: "Sunlit", blurb: "Cream and butter-yellow with dark ink pills.", mode: "light", swatch: ["#f7f0d2", "#f2c230", "#23211a"],
    vars: {
      bg: "#f4eed6", page: "linear-gradient(160deg,#f8f4e6 0%,#f6efcc 55%,#f3e49a 100%)",
      atmo: "radial-gradient(circle at 90% 90%, rgba(242,194,48,.35) 0%, transparent 46%), radial-gradient(circle at 10% 10%, rgba(255,255,255,.7) 0%, transparent 42%)",
      text: "#34301f", ink: "#1f1d14", ov: "#3a3414", black: "#1f1d14",
      z: ["#1f1d14", "#332f1f", "#4f4a33", "#75704f", "#9a9570", "#bdb893", "#d9d5b8", "#e9e5cc", "#f3f0dd", "#faf8ec"],
      v: ["#fff6cf", "#ffec9d", "#fbdc62", "#f6cd40", "#f2c230", "#dca90f", "#b4870b", "#876409", "#5b4306", "#352703"],
      onAccent: "#241d05", glass: "rgba(255,255,255,0.62)", glassBorder: "rgba(255,255,255,0.8)", userBubble: "#23211a", userBubbleInk: "#fff6cf", radius: "1.6rem",
    },
  },
  {
    id: "ink", name: "Ink & Lilac", blurb: "Near-white pages, black sidebar, lilac touches.", mode: "light", swatch: ["#fbfaff", "#17141f", "#8b7cf6"],
    vars: {
      bg: "#f1f0f8", page: "linear-gradient(180deg,#f8f7fd 0%,#eeedf8 100%)",
      atmo: "radial-gradient(circle at 90% 8%, rgba(139,124,246,.14) 0%, transparent 40%), radial-gradient(circle at 5% 95%, rgba(139,124,246,.10) 0%, transparent 44%)",
      text: "#24212f", ink: "#17141f", ov: "#251f40", black: "#17141f",
      z: ["#17141f", "#2a2635", "#433e52", "#6b6679", "#8e8a9c", "#b2aebf", "#d3d0de", "#e6e4ee", "#f1f0f6", "#f9f8fc"],
      v: ["#ece9ff", "#d9d3ff", "#bbb0ff", "#8b7cf6", "#6d5ef0", "#27222f", "#1c1825", "#14111b", "#0d0b12", "#07060a"],
      onAccent: "#ffffff", glass: "rgba(255,255,255,0.85)", glassBorder: "rgba(40,30,90,0.08)", userBubble: "#27222f", userBubbleInk: "#ffffff", radius: "1.5rem",
    },
  },
];

export const THEME_IDS = THEMES.map(t => t.id);
export const themeById = (id: string | undefined | null): Theme => THEMES.find(t => t.id === id) || THEMES[0];

/** The parts of the app that can have their own theme. */
export const THEME_MODULES: { id: string; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "vision", label: "Vision" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "series", label: "Series" },
  { id: "models", label: "Models" },
  { id: "memory", label: "Memory" },
  { id: "engine", label: "Engine" },
  { id: "console", label: "Console" },
  { id: "settings", label: "Settings" },
];

export interface ThemeChoice { theme: string; themeMode: "global" | "modules"; moduleThemes: Record<string, string> }

/** The theme a module is shown in: its own when per-module themes are on and one is set, else the global one. */
export function effectiveTheme(choice: ThemeChoice, moduleId: string): string {
  const own = choice.themeMode === "modules" ? choice.moduleThemes[moduleId] : undefined;
  return themeById(own || choice.theme).id;
}

const STEPS = ["100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

/** CSS for every theme. Tailwind utilities read `--color-*`, so re-pointing those under `[data-theme]` re-colours a whole subtree. */
export function themeCss(): string {
  return THEMES.map(t => {
    const v = t.vars;
    const decl = [
      `--t-bg:${v.bg}`, `--t-page:${v.page}`, `--t-atmo:${v.atmo}`, `--t-text:${v.text}`, `--t-glass:${v.glass}`, `--t-glass-border:${v.glassBorder}`,
      `--t-bubble:${v.userBubble}`, `--t-bubble-ink:${v.userBubbleInk}`, `--color-white:${v.ov}`, `--color-black:${v.black}`,
      ...STEPS.map((s, i) => `--color-zinc-${s}:${v.z[i]}`),
      ...STEPS.map((s, i) => `--color-violet-${s}:${v.v[i]}`),
    ].join(";");
    const sel = `[data-theme="${t.id}"]`;
    // Text on accent buttons / white buttons keeps its contrast whatever the overlay colour is.
    return `${sel}{${decl};color-scheme:${t.mode};color:${v.text}}`
      + `${sel} :is(.bg-violet-500,.bg-violet-600,.bg-violet-700,.bg-violet-900,.from-violet-500,.from-violet-600){--color-white:${v.onAccent}}`
      + `${sel} .bg-white{--color-black:${v.bg}}`;
  }).join("\n");
}

export function installThemes() {
  let el = document.getElementById("cursed-themes") as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = "cursed-themes"; document.head.appendChild(el); }
  el.textContent = themeCss();
}
