# Before the Dragons — Pre-Targaryen History Reel Series

A vertical (9:16) YouTube Shorts / Reels series covering the history of the known world **before House Targaryen rises** — from the Dawn Age of Westeros to the Doom of Valyria, ending on the hook that leads into Aegon's Conquest.

All narration is original writing. No source text is quoted.

## Format

| Parameter | Value |
|---|---|
| Model | MiniMax H3, T2VA (text-to-video-audio) |
| Clip length | 8.00 s per generation |
| Clips per episode | 8 |
| Episode runtime | ~64 s (trim to ~58–60 s in the edit) |
| Aspect | 9:16 vertical |
| Narrator | Single voice, ID `(S1)`, re-established in every clip |
| On-screen text | One short card per clip, burned in via the prompt |

Each clip is generated independently, so **style and narrator identity must be restated in full in every prompt**. Copy the style lock and the voice lock verbatim — do not paraphrase between clips, or the look and voice will drift.

## Style lock (paste verbatim into every prompt)

> Live-action, cinematic, filmed in vertical 9:16 framing, desaturated cold color grade with deep blacks, heavy volumetric haze, handheld-stabilized documentary realism, shallow depth of field.

## Voice lock (paste verbatim into every prompt)

> a narrator with a deep, gravelly, slow-paced voice and a neutral British accent (S1)

## Episode map

| # | Title | Era covered | Closing hook |
|---|---|---|---|
| 1 | The World Before Men | Dawn Age — children of the forest, giants, weirwoods, arrival of the First Men, the Pact | "But the dark was not finished with them." |
| 2 | The Long Night | The Others, the Last Hero, the Wall, the founding of the Night's Watch | "Eight thousand years of quiet followed. It would not last." |
| 3 | The Empire of Chains | Old Ghis, the Ghiscari legions, the first slave empire | "Far to the west, shepherds were about to find something worse." |
| 4 | Fourteen Flames | Valyrian shepherds discover dragons; the Freehold is born | "Ghis had legions. Valyria had dragons." |
| 5 | Five Wars, One Ash Field | The Ghiscari wars; Ghis burned and sown with salt | "Nothing now stood between Valyria and the world." |
| 6 | The Freehold | Valyria at its height — sorcery, Valyrian steel, dragonroads, the mines | "Every empire mistakes its peak for its permanence." |
| 7 | The Andal Tide | Andals cross the narrow sea; the Faith; the fall of the First Men kingdoms | "One kingdom in the North never bent. One kingdom in the south was still to come." |
| 8 | Ten Thousand Ships | The Rhoynar wars, Garin's curse, Nymeria's crossing, the birth of Dorne | "Valyria had won again. It had one century left." |
| 9 | The Dream of Fire | Daenys the Dreamer; House Targaryen sells up and sails to Dragonstone | "Their neighbours laughed. Twelve years remained." |
| 10 | The Doom | The Doom of Valyria; the Century of Blood; one small family on one small rock | "The last dragonlords in the world were now a single household." |

Episodes 1 and 9 are written out in full below (`EP01_*.md`, `EP09_*.md`). The rest follow the same eight-beat skeleton:

1. **Hook** — a question or a stakes line over a wide establishing shot.
2. **World** — where and when.
3. **Actor A** — the first power.
4. **Actor B** — the opposing power.
5. **Collision** — the conflict begins.
6. **Turn** — the irreversible act.
7. **Consequence** — what the world looks like after.
8. **Hook out** — one line that forces the next episode.

## Generation settings (measured on RTX 5060 Laptop, 8 GB VRAM)

Local MiniMax H3 via `MiniMaxH3ReferenceToVideo`, driven by `tools/comfy_h3.py`.

| Setting | Value |
|---|---|
| Resolution | **544x928** (0.5 MP at 9:16, snapped to /32) |
| Length | 7 s requested = **175 frames** @ 24 fps = 7.29 s actual |
| Steps | 12 |
| Sampler | `res_multistep`, `simple` scheduler |
| Ref images | style plate always `<Picture 1>`, characters `<Picture 2>`/`<Picture 3>` |
| `ref_image_size` | `match` |

Measured cost per clip at these settings: **20-40 min**, varying with whether the model is already resident (a cold first job after a server restart lands at the top of that band). For comparison, 768x1344
at 8 s took ~81-86 min, which is why Episode 1 clips 2-6 are the only ones at
that size. Frame counts must land on the model's 17k+5 grid, so 7 s becomes 175
frames (7.29 s) - `snap_length()` handles this, do not hand-set frame counts.

## Production notes

- Generate all 8 clips of an episode in one sitting; MiniMax output drifts between sessions.
- Cut on the narration, not on the visuals — the VO line ends ~0.5 s before the clip ends in every prompt, which gives you a clean splice point.
- `non_diegetic_music` is written to be continuous in character across an episode but each clip is generated separately, so lay one continuous music bed over the whole episode in the edit and duck the generated music, or set `non_diegetic_music: N/A` on clips 2–8 and score the episode yourself. The second option is cleaner.
- On-screen text cards are burned in by the model and will not be perfectly typeset. If you need clean typography, strip the text card lines from the prompts and add the cards in post.
