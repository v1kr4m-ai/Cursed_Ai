/**
 * The kinds of video a series can be. A format decides what the "line" of a scene is (narration over
 * pictures, a creator talking to the camera, a lyric, nothing at all), how the scene prompt is worded
 * for the video model, and what the planner is told to write.
 *
 * Pure data and string building: the server uses it to build prompts, the page to show the choices.
 */

export type Speech = "voiceover" | "oncamera" | "sung" | "none";

export interface SeriesFormat {
  id: string;
  label: string;
  blurb: string;
  speech: Speech;
  /** What the per-scene text box is called in the board. */
  lineLabel: string;
  /** Placeholder/help for that box. */
  lineHint: string;
  /** Words per line the planner should aim for (a line has to fit the clip length). */
  lineWords: string;
  /** What the planner is told about shots and lines for this format. */
  plan: string;
  /** One sample shot, shown to the planner so it writes real shots instead of leaving the field empty. */
  shotExample: string;
  /** Camera and look phrase added to every scene prompt. */
  look: string;
  /** Who speaks or sings, used when the project still has the default narrator voice. */
  voice: string;
  /** The music/sound line of the prompt. */
  sound: string;
  music: string;
}

export const DEFAULT_FORMAT = "narration";

export const SERIES_FORMATS: SeriesFormat[] = [
  {
    shotExample: "An aerial shot glides over a grey harbour at dawn, fishing boats rocking in the mist.",
    id: "narration", label: "Narration", blurb: "A voice narrates over cinematic pictures. Documentaries, explainers, stories.",
    speech: "voiceover", lineLabel: "Narration", lineHint: "One narration line, spoken over the clip.", lineWords: "18-22",
    plan: "Each scene is a cinematic shot with a narrator speaking over it. The camera never shows the narrator.",
    look: "", voice: "", sound: "Ambient sound and physical action sounds that match the shot, continuous across the clip.", music: "N/A",
  },
  {
    shotExample: "Close selfie shot in a sunny kitchen, she lifts a coffee cup towards the lens and smiles while she talks.",
    id: "vlog", label: "Self vlog", blurb: "One person films themselves, talking to the camera, selfie style.",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the person says to the camera in this clip.", lineWords: "14-18",
    plan: "Each scene is a selfie-style vlog shot: the person holds the camera at arm's length or uses a phone stand, looks into the lens and talks to the viewer in first person, in a real everyday place. The shot field describes the place, framing and what they are doing while they talk.",
    look: "Handheld selfie-camera vlog footage, the person looks into the lens, natural light, slight camera shake, authentic and unpolished.",
    voice: "a young creator with a warm, natural, conversational voice",
    sound: "The person's own voice, clear and close, with the natural background sounds of the place.", music: "N/A",
  },
  {
    shotExample: "Selfie-style shot in a bright bedroom, she holds up a denim jacket against her chest and turns to show the back.",
    id: "ugc", label: "UGC / review", blurb: "A creator shows and talks about a product or outfit, like a real social post.",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the creator says in this clip.", lineWords: "14-18",
    plan: "Each scene is user-generated-style phone footage: the creator talks to the camera, shows the product or outfit, tries it on, holds it up or demonstrates it. Casual, honest, enthusiastic, never an advert read-out. The shot field says where they are, what they hold or wear and how the camera moves.",
    look: "Vertical phone footage in the style of an authentic social media creator, natural lighting, the person faces the camera and handles the product naturally.",
    voice: "a friendly young woman with a natural, enthusiastic, conversational voice",
    sound: "The creator's own voice, clear and close, with light natural room sound.", music: "N/A",
  },
  {
    shotExample: "Steady medium shot at a desk in front of a bookshelf, the presenter leans in and gestures with one hand.",
    id: "presenter", label: "Presenter", blurb: "A person explains something to the camera from a steady shot. Talking head, news, how-to.",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the presenter says in this clip.", lineWords: "16-20",
    plan: "Each scene is a steady medium shot of one presenter speaking to the camera, with the background or a graphic-free prop changing between scenes to keep it alive. The shot field describes framing, background and gesture.",
    look: "Steady tripod medium shot, the presenter looks into the lens and speaks, soft key light, clean background.",
    voice: "a confident presenter with a clear, friendly, measured voice",
    sound: "The presenter's own voice, clear and close, quiet room tone.", music: "N/A",
  },
  {
    shotExample: "Low-angle shot on a dim stage, the singer grips the microphone and sings into a warm spotlight.",
    id: "singing", label: "Singing", blurb: "A person sings the lyrics to the camera over a backing track. Music video clips.",
    speech: "sung", lineLabel: "Lyric line", lineHint: "The lyric sung in this clip.", lineWords: "8-14",
    plan: "Each scene is a performance shot of the singer. The line is one lyric line, written so the lines together form a song with a rhyme and a chorus. The shot field describes the setting, the camera move and the performance energy.",
    look: "Music-video performance footage, the singer faces the camera and sings with expressive emotion, dramatic lighting.",
    voice: "a singer with an expressive, melodic voice",
    sound: "The singer's voice carrying the melody, clearly performed, over a full backing track.", music: "A catchy backing track that fits the song's mood and keeps the same tempo and key across the clip.",
  },
  {
    shotExample: "Full-body shot on a rooftop at sunset, the dancer spins into a sharp hip-hop freeze as the camera circles.",
    id: "dancing", label: "Dancing", blurb: "A person dances to music. Trends, choreography, no talking.",
    speech: "none", lineLabel: "Move / beat", lineHint: "The dance move or beat this clip shows (not spoken).", lineWords: "8-14",
    plan: "Each scene is a dance shot with no talking. The line is a short note on the move or the beat in this clip, for the editor only. The shot field describes the dancer, the move, the space and the camera movement.",
    look: "Full-body dance footage, fluid rhythmic movement in time with the music, the camera follows the dancer.",
    voice: "",
    sound: "Music-driven: the beat, footsteps and body movement. No speech.", music: "An energetic, rhythmic dance track with a strong beat, continuous across the clip.",
  },
  {
    shotExample: "Slow push-in on an empty train platform at night, steam drifting under a flickering lamp.",
    id: "cinematic", label: "Cinematic (no voice)", blurb: "Pictures and music only. Mood films, teasers, b-roll.",
    speech: "none", lineLabel: "Mood note", lineHint: "A note on the mood of this clip (not spoken).", lineWords: "8-14",
    plan: "Each scene is a cinematic shot with no voice or dialogue. The line is a short mood note for the editor. The shot field carries the story through action and visuals alone.",
    look: "Cinematic footage, expressive camera movement.",
    voice: "",
    sound: "Natural ambience and physical sounds that match the action. No speech.", music: "A subtle score that matches the mood of the shot.",
  },
  {
    shotExample: "Top-down close-up of hands folding dough on a floured wooden board, flour dusting the air.",
    id: "tutorial", label: "How-to (hands)", blurb: "A voice explains steps while hands do the work. Recipes, crafts, tech tips.",
    speech: "voiceover", lineLabel: "Instruction", lineHint: "The step the voice explains over this clip.", lineWords: "14-20",
    plan: "Each scene shows one step of the process in close-up, mostly hands and materials, with a voice explaining the step. The shot field describes exactly what the hands do and what is visible.",
    look: "Top-down and close-up instructional footage, clean even light, hands and materials in sharp focus.",
    voice: "",
    sound: "The sounds of the activity itself, clear and close.", music: "N/A",
  },
];

export const formatOf = (id?: string): SeriesFormat => SERIES_FORMATS.find(f => f.id === id) || SERIES_FORMATS[0];

/** Words that make a video model paint captions into the picture; they are dropped from the look. */
const CAPTION_WORDS = /\b(captions?|subtitles?|text overlays?|on-?screen text|watermarks?)\b/i;

/** The style lock without anything that asks for burned-in text. */
export function cleanLook(look: string): string {
  return look.split(/,\s*/).filter(part => part.trim() && !CAPTION_WORDS.test(part)).join(", ");
}

export const NO_TEXT = "No subtitles, captions, lyrics text, watermarks, logos or any other writing appear in the frame.";

/**
 * The three prompt fields the video model expects for one scene.
 * `voice` is the project's own voice description; the format's default replaces the narrator default.
 */
export function sceneFields(opts: { format: SeriesFormat; look: string; voice: string; line: string; shot: string; card: string; allowCard: boolean }) {
  const { format, line, shot } = opts;
  const look = [cleanLook(opts.look), format.look].filter(Boolean).join(" ");
  const card = opts.allowCard && opts.card.trim() ? ` Plain white text reading "${opts.card.trim()}" appears low in the frame.` : "";
  const noText = opts.allowCard && opts.card.trim() ? "" : ` ${NO_TEXT}`;
  const text = line.trim();
  let spoken = "";
  switch (format.speech) {
    case "voiceover": spoken = text ? ` A ${opts.voice} says in an off-screen voiceover: <d>[English] ${text}</d>` : ""; break;
    case "oncamera": spoken = text ? ` The person in the shot, ${opts.voice}, looks at the camera and says, with natural lip movement: <d>[English] ${text}</d>` : ""; break;
    case "sung": spoken = text ? ` The person in the shot, ${opts.voice}, sings this lyric to the camera with natural lip movement: <d>[English] ${text}</d>` : ""; break;
    case "none": spoken = " Nobody speaks in this clip."; break;
  }
  return {
    description: `integrated_multimodal_description: [Shot 1] ${look} ${shot.trim()}${card}${spoken}${noText}`.replace(/\s+/g, " ").trim(),
    soundscape: `overall_soundscape: ${format.sound}`,
    music: `non_diegetic_music: ${format.music}`,
  };
}
