/**
 * The kinds of video a series can be. A format decides what the "line" of a scene is (narration over
 * pictures, a creator talking to the camera, a lyric, nothing at all), how the scene prompt is worded
 * for the video model, and what the planner is told to write.
 *
 * Pure data and string building: the server uses it to build prompts, the page to show the choices.
 */

export type Speech = "voiceover" | "oncamera" | "dialogue" | "sung" | "none";

/** Whether the clips carry a voice: the style's own choice, never, or always (the person talks to the camera). */
export type VoiceMode = "auto" | "off" | "on";

export interface SeriesFormat {
  id: string;
  label: string;
  blurb: string;
  /** Where the style sits in the picker. */
  group: string;
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
    id: "narration", label: "Narration", blurb: "A voice narrates over cinematic pictures. Documentaries, explainers, stories.", group: "Voice over",
    speech: "voiceover", lineLabel: "Narration", lineHint: "One narration line, spoken over the clip.", lineWords: "18-22",
    plan: "Each scene is a cinematic shot with a narrator speaking over it. The camera never shows the narrator.",
    look: "", voice: "", sound: "Ambient sound and physical action sounds that match the shot, continuous across the clip.", music: "N/A",
  },
  {
    shotExample: "Close selfie shot in a sunny kitchen, she lifts a coffee cup towards the lens and smiles while she talks.",
    id: "vlog", label: "Self vlog", blurb: "One person films themselves, talking to the camera, selfie style.", group: "Talking to the camera",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the person says to the camera in this clip.", lineWords: "14-18",
    plan: "Each scene is a selfie-style vlog shot: the person holds the camera at arm's length or uses a phone stand, looks into the lens and talks to the viewer in first person, in a real everyday place. The shot field describes the place, framing and what they are doing while they talk.",
    look: "Handheld selfie-camera vlog footage, the person looks into the lens, natural light, slight camera shake, authentic and unpolished.",
    voice: "a young creator with a warm, natural, conversational voice",
    sound: "The person's own voice, clear and close, with the natural background sounds of the place.", music: "N/A",
  },
  {
    shotExample: "Selfie-style shot in a bright bedroom, she holds up a denim jacket against her chest and turns to show the back.",
    id: "ugc", label: "UGC / review", blurb: "A creator shows and talks about a product or outfit, like a real social post.", group: "Talking to the camera",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the creator says in this clip.", lineWords: "14-18",
    plan: "Each scene is user-generated-style phone footage: the creator talks to the camera, shows the product or outfit, tries it on, holds it up or demonstrates it. Casual, honest, enthusiastic, never an advert read-out. The shot field says where they are, what they hold or wear and how the camera moves.",
    look: "Vertical phone footage in the style of an authentic social media creator, natural lighting, the person faces the camera and handles the product naturally.",
    voice: "a friendly young woman with a natural, enthusiastic, conversational voice",
    sound: "The creator's own voice, clear and close, with light natural room sound.", music: "N/A",
  },
  {
    shotExample: "Steady medium shot at a desk in front of a bookshelf, the presenter leans in and gestures with one hand.",
    id: "presenter", label: "Presenter", blurb: "A person explains something to the camera from a steady shot. Talking head, news, how-to.", group: "Talking to the camera",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the presenter says in this clip.", lineWords: "16-20",
    plan: "Each scene is a steady medium shot of one presenter speaking to the camera, with the background or a graphic-free prop changing between scenes to keep it alive. The shot field describes framing, background and gesture.",
    look: "Steady tripod medium shot, the presenter looks into the lens and speaks, soft key light, clean background.",
    voice: "a confident presenter with a clear, friendly, measured voice",
    sound: "The presenter's own voice, clear and close, quiet room tone.", music: "N/A",
  },
  {
    shotExample: "Low-angle shot on a dim stage, the singer grips the microphone and sings into a warm spotlight.",
    id: "singing", label: "Singing", blurb: "A person sings the lyrics to the camera over a backing track. Music video clips.", group: "Music and movement",
    speech: "sung", lineLabel: "Lyric line", lineHint: "The lyric sung in this clip.", lineWords: "8-14",
    plan: "Each scene is a performance shot of the singer. The line is one lyric line, written so the lines together form a song with a rhyme and a chorus. The shot field describes the setting, the camera move and the performance energy.",
    look: "Music-video performance footage, the singer faces the camera and sings with expressive emotion, dramatic lighting.",
    voice: "a singer with an expressive, melodic voice",
    sound: "The singer's voice carrying the melody, clearly performed, over a full backing track.", music: "A catchy backing track that fits the song's mood and keeps the same tempo and key across the clip.",
  },
  {
    shotExample: "Full-body shot on a rooftop at sunset, the dancer spins into a sharp hip-hop freeze as the camera circles.",
    id: "dancing", label: "Dancing", blurb: "A person dances to music. Trends, choreography, no talking.", group: "Music and movement",
    speech: "none", lineLabel: "Move / beat", lineHint: "The dance move or beat this clip shows (not spoken).", lineWords: "8-14",
    plan: "Each scene is a dance shot with no talking. The line is a short note on the move or the beat in this clip, for the editor only. The shot field describes the dancer, the move, the space and the camera movement.",
    look: "Full-body dance footage, fluid rhythmic movement in time with the music, the camera follows the dancer.",
    voice: "",
    sound: "Music-driven: the beat, footsteps and body movement. No speech.", music: "An energetic, rhythmic dance track with a strong beat, continuous across the clip.",
  },
  {
    shotExample: "Slow push-in on an empty train platform at night, steam drifting under a flickering lamp.",
    id: "cinematic", label: "Cinematic (no voice)", blurb: "Pictures and music only. Mood films, teasers, b-roll.", group: "Visual story",
    speech: "none", lineLabel: "Mood note", lineHint: "A note on the mood of this clip (not spoken).", lineWords: "8-14",
    plan: "Each scene is a cinematic shot with no voice or dialogue. The line is a short mood note for the editor. The shot field carries the story through action and visuals alone.",
    look: "Cinematic footage, expressive camera movement.",
    voice: "",
    sound: "Natural ambience and physical sounds that match the action. No speech.", music: "A subtle score that matches the mood of the shot.",
  },
  {
    shotExample: "Top-down close-up of hands folding dough on a floured wooden board, flour dusting the air.",
    id: "tutorial", label: "How-to (hands)", blurb: "A voice explains steps while hands do the work. Recipes, crafts, tech tips.", group: "Voice over",
    speech: "voiceover", lineLabel: "Instruction", lineHint: "The step the voice explains over this clip.", lineWords: "14-20",
    plan: "Each scene shows one step of the process in close-up, mostly hands and materials, with a voice explaining the step. The shot field describes exactly what the hands do and what is visible.",
    look: "Top-down and close-up instructional footage, clean even light, hands and materials in sharp focus.",
    voice: "",
    sound: "The sounds of the activity itself, clear and close.", music: "N/A",
  },
  {
    shotExample: "Tracking shot beside a girl walking down a sunny street; she grabs a red dress from a hanger on a shop rail as she passes, and in the next step she is wearing it.",
    id: "outfit-change", label: "Outfit change / transition", blurb: "A person keeps moving while her outfit changes: she picks the next look from a hanger or rack and is wearing it a step later.", group: "Fashion and products",
    speech: "none", lineLabel: "Look and transition", lineHint: "Which outfit this clip shows and how she changes into the next one (not spoken).", lineWords: "8-14",
    plan: "Each scene is one step of a continuous walk (a street, a corridor, a market) with a smooth outfit transition. The person keeps walking; she takes the next outfit from a hanger, a rack, a shop window or a friend's hand and is wearing it a step later, or a spin, a door pass or a hand-over-lens wipe changes the look. The same person and the same place carry through every scene. Each outfit gets its own ref with kind 'outfit', named like outfit_red_dress, and the scene lists that ref. The shot says the outfit she starts in, the move that changes it and the outfit she ends in.",
    look: "Smooth tracking shot of one person walking, steady fashion-video framing, natural daylight, a believable and seamless clothing change.",
    voice: "", sound: "Footsteps, street ambience and the rustle of fabric. No speech.", music: "N/A",
  },
  {
    shotExample: "Medium tracking shot walking backwards in front of a woman strolling along a tree-lined street, she smiles and gestures with a coffee cup.",
    id: "street-walk", label: "Walking vlog / street", blurb: "A person walks through a street or market and talks, or just walks, with a tracking camera.", group: "Fashion and products",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the person says while walking.", lineWords: "12-16",
    plan: "Each scene is a tracking or handheld shot of one person walking through a real place: a street, a market, a station, a seafront. The camera follows or walks backwards in front of her; things in the street change from scene to scene. The shot says where she is, what she passes and what she is doing with her hands.",
    look: "Handheld or gimbal tracking shot of a person walking through a real street, natural daylight, lively background, authentic walking-vlog footage.",
    voice: "a friendly young woman with a natural, conversational voice",
    sound: "The person's own voice over street ambience and footsteps.", music: "N/A",
  },
  {
    shotExample: "Mirror shot of a woman in a bright dressing room holds up two tops, then pulls the green one over her head and turns to show it.",
    id: "grwm", label: "Get ready with me", blurb: "Skincare, makeup and picking the outfit, step by step.", group: "Fashion and products",
    speech: "oncamera", lineLabel: "Spoken line", lineHint: "What she says while getting ready.", lineWords: "12-16",
    plan: "Each scene is one step of getting ready: skincare, makeup, hair, choosing the outfit, the final look. She talks to the camera or the mirror in a bedroom or bathroom. The shot says which step, what she holds or applies and where she looks.",
    look: "Bright, intimate bathroom or bedroom footage, phone propped on a shelf or held, soft window light, authentic get-ready-with-me style.",
    voice: "a warm, chatty young woman with a natural voice",
    sound: "Her own voice, with soft room sound, the clicks of makeup cases and fabric.", music: "N/A",
  },
  {
    shotExample: "Low-angle shot of a model in a long camel coat stepping down a bright concrete runway, camera sliding back to keep her centred.",
    id: "fashion", label: "Fashion lookbook / runway", blurb: "Looks shown with confident walks, turns and poses, like a lookbook or a runway.", group: "Fashion and products",
    speech: "none", lineLabel: "Look", lineHint: "The outfit and pose in this clip (not spoken).", lineWords: "8-14",
    plan: "Each scene shows one look: the model walks, turns and poses in a styled place such as a runway, a studio sweep or a rooftop. Each outfit gets its own ref with kind 'outfit'. The shot says the look, the walk or pose and how the camera moves.",
    look: "Polished fashion-film footage, confident model walk, controlled lighting and elegant camera movement.",
    voice: "", sound: "Footsteps and the sound of fabric. No speech.", music: "N/A",
  },
  {
    shotExample: "Close top-down shot of hands lifting the lid of a small white box on a wooden table and lifting out a folded linen shirt.",
    id: "product-demo", label: "Product showcase / unboxing", blurb: "An item shown, unboxed, used and described. Clothing, gadgets, beauty.", group: "Fashion and products",
    speech: "voiceover", lineLabel: "Benefit line", lineHint: "One line about the product, spoken over the clip.", lineWords: "12-16",
    plan: "Each scene shows the product: unboxing, close-up detail, using it, comparing sizes or colours, wearing it. The product has its own ref with kind 'product'. The shot says exactly what is shown and what the hands or the person do with it.",
    look: "Clean product footage, soft even light, sharp close-ups of texture and detail, hands and surfaces tidy.",
    voice: "a confident, friendly voice",
    sound: "The sounds of the product and the hands: paper, fabric, clicks and taps.", music: "N/A",
  },
  {
    shotExample: "First-person view looking down at her own hands zipping a jacket, then up at a rainy street as she steps outside.",
    id: "pov", label: "First-person POV", blurb: "We see what she sees: her hands, her view, her steps.", group: "Visual story",
    speech: "voiceover", lineLabel: "Inner voice", lineHint: "What she thinks or says as we see through her eyes.", lineWords: "12-16",
    plan: "Each scene is seen through the eyes of one person: her hands, what she looks at, her feet on the ground. The camera is the person. The shot says what her eyes see and what her hands do. The person's own face is seen only in a mirror or a reflection.",
    look: "Handheld first-person footage at eye height, natural motion, hands entering the frame.",
    voice: "a young woman with a close, natural inner-monologue voice",
    sound: "Natural ambience and the sounds of her hands and steps.", music: "N/A",
  },
  {
    shotExample: "Two friends at a cafe table, the one on the left leans in and whispers; the other laughs and swats her arm.",
    id: "skit", label: "Skit / dialogue", blurb: "Two or more people talk to each other. Comedy, scenes, interviews.", group: "Talking to the camera",
    speech: "dialogue", lineLabel: "Dialogue", lineHint: "Who says what, for example: Maya: I can't believe it!", lineWords: "10-16",
    plan: "Each scene is a short exchange between two or more people. Write the line with the speaker first, like 'Maya: I cannot believe it!'. The shot says who is in frame, where they stand and how they react. People are named in the cast and listed in the scene's cast.",
    look: "Natural two-person scene footage, simple blocking, shallow depth of field, authentic expressions.",
    voice: "natural, expressive voices",
    sound: "The people's own voices, close and clear, with the natural sound of the place.", music: "N/A",
  },
  {
    shotExample: "Wide locked shot of an empty, scruffy living room; the next cut shows the same room freshly painted with new furniture.",
    id: "transformation", label: "Before / after transformation", blurb: "A makeover, a room redo or a glow-up shown in clear steps.", group: "Visual story",
    speech: "none", lineLabel: "Step", lineHint: "The step shown in this clip (not spoken).", lineWords: "8-14",
    plan: "Each scene is one stage of a transformation, from the before to the after. Keep the framing the same from scene to scene so the change is easy to see. The shot says the stage, what changes and how it is revealed.",
    look: "Clean, consistent framing from the same camera position, clear lighting so each change reads at once.",
    voice: "", sound: "Natural ambience and the sounds of the work. No speech.", music: "N/A",
  },
  {
    shotExample: "Slow gimbal shot rising over a hillside old town at golden hour, a woman in a yellow scarf crossing a stone bridge in the foreground.",
    id: "travel", label: "Travel / city montage", blurb: "Places and moments cut together. Trips, cities, food, markets.", group: "Visual story",
    speech: "none", lineLabel: "Moment", lineHint: "The place or moment in this clip (not spoken).", lineWords: "8-14",
    plan: "Each scene is a different place or moment of a trip: a landmark, a street, a meal, a market, a viewpoint. The shot says the place, the light and the camera move. A person may appear but is not the focus.",
    look: "Cinematic travel footage, golden light, smooth camera moves, rich real-world detail.",
    voice: "", sound: "Natural ambience of the place: voices, traffic, wind, water. No speech.", music: "N/A",
  },
  {
    shotExample: "Extreme close-up of a spoon slowly pressing into a bowl of glossy slime, a soft squelch, shallow depth of field.",
    id: "asmr", label: "ASMR / satisfying", blurb: "Close, slow, tactile shots with the sound of the thing itself.", group: "Visual story",
    speech: "none", lineLabel: "Texture", lineHint: "The texture or action in this clip (not spoken).", lineWords: "6-12",
    plan: "Each scene is a close, slow, satisfying action with a clear sound: cutting, pouring, pressing, tapping, folding. The shot says the object, the action and the sound it makes.",
    look: "Extreme close-up macro footage, slow smooth motion, soft studio light and shallow depth of field.",
    voice: "", sound: "Close, clear sounds of the action itself, nothing else. No speech.", music: "N/A",
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
    case "dialogue": spoken = text ? ` The people in the shot talk to each other, with natural lip movement, each line spoken by the person named first: <d>[English] ${text}</d>` : ""; break;
    case "sung": spoken = text ? ` The person in the shot, ${opts.voice}, sings this lyric to the camera with natural lip movement: <d>[English] ${text}</d>` : ""; break;
    case "none": spoken = " Nobody speaks in this clip."; break;
  }
  return {
    description: `integrated_multimodal_description: [Shot 1] ${look} ${shot.trim()}${card}${spoken}${noText}`.replace(/\s+/g, " ").trim(),
    soundscape: `overall_soundscape: ${format.sound}`,
    music: `non_diegetic_music: ${format.music}`,
  };
}

/**
 * The style as this project uses it. The voice switch can silence any style (no speech, no generated music, so the
 * clips are clean for your own soundtrack) or make a silent style talk to the camera.
 */
export function projectFormat(p: { format?: string; voice?: VoiceMode }): SeriesFormat {
  const f = formatOf(p.format);
  if (p.voice === "off") {
    if (f.speech === "none") return { ...f, music: "N/A" };
    return { ...f, speech: "none", lineLabel: "Action note", lineHint: "What happens in this clip (not spoken).", lineWords: "8-14", voice: "", sound: "Natural ambience and the sounds of the action. No speech.", music: "N/A", plan: f.plan + " In this series nobody talks: the line is only a short note for the editor about what happens." };
  }
  if (p.voice === "on" && f.speech === "none") {
    return { ...f, speech: "oncamera", lineLabel: "Spoken line", lineHint: "What the person says to the camera in this clip.", lineWords: "12-16", voice: f.voice || "a young creator with a warm, natural, conversational voice", sound: "The person's own voice, clear and close, with the natural sounds of the place.", music: "N/A", plan: f.plan + " The person also talks to the camera while this happens: the line is what she says." };
  }
  return f;
}
