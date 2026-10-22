/**
 * What a reference picture is for. The kind decides how the scene prompt tells the video model to use the
 * picture ("wears exactly this outfit", "the product looks exactly like this", "the colours come from this")
 * and the order photos are given to an image-to-image workflow (the person first).
 *
 * A ref keeps its older two-way `role` (style / character) for everything that only needs to know whether
 * a picture is a look or a subject; the kind is the finer choice shown to the person.
 */

export type RefKind = "person" | "outfit" | "product" | "location" | "pose" | "prop" | "palette" | "style" | "other";

export interface RefKindInfo {
  id: RefKind;
  label: string;
  blurb: string;
  /** The coarse role this kind maps to. */
  role: "style" | "character";
  /** The sentence that tells the video model what to take from the picture. */
  wiring: (picture: string, name: string) => string;
}

export const REF_KINDS: RefKindInfo[] = [
  { id: "person", label: "Person / face", blurb: "Who is in the video: face, hair, skin and body.", role: "character",
    wiring: (p, n) => `Use ${p} as the exact appearance reference for ${n}, preserving face, hair, skin tone, clothing and proportions.` },
  { id: "outfit", label: "Outfit / costume", blurb: "Clothing the person wears: a dress, a kurta, sportswear.", role: "character",
    wiring: (p, n) => `Use ${p} as the outfit reference ("${n}"): the person wears exactly this clothing, same cut, colour and fabric.` },
  { id: "product", label: "Product", blurb: "An item that is shown or held: a bag, a bottle, a gadget.", role: "character",
    wiring: (p, n) => `Use ${p} as the product reference ("${n}"): the product looks exactly like this, with the same shape, colour and any markings, and is shown or held naturally.` },
  { id: "location", label: "Location / background", blurb: "Where it happens: a room, a street, a shop.", role: "character",
    wiring: (p, n) => `Use ${p} as the location reference ("${n}"): the setting and background match this place.` },
  { id: "pose", label: "Pose / composition", blurb: "How the person stands and how the shot is framed.", role: "character",
    wiring: (p, n) => `Use ${p} as the pose and framing reference ("${n}"): the person takes this pose and the shot is composed the same way.` },
  { id: "prop", label: "Prop / object", blurb: "Something in the scene: furniture, food, a car.", role: "character",
    wiring: (p, n) => `Use ${p} as the reference for the object "${n}": it appears in the scene looking exactly like this.` },
  { id: "palette", label: "Colour palette", blurb: "The colours to use, from a swatch, a poster or a photo.", role: "style",
    wiring: (p, n) => `Use ${p} as the colour palette reference ("${n}"): the colours of the whole shot come from this picture.` },
  { id: "style", label: "Style / look", blurb: "The grade, lighting and mood of the whole video.", role: "style",
    wiring: p => `Use ${p} as the visual style reference for grade, lighting, haze and lens character.` },
  { id: "other", label: "Other reference", blurb: "Anything else the scene should match.", role: "character",
    wiring: (p, n) => `Use ${p} as a reference for "${n}", matching it closely.` },
];

const byId = new Map(REF_KINDS.map(k => [k.id, k]));

export const refKindInfo = (id?: string): RefKindInfo | undefined => (id ? byId.get(id as RefKind) : undefined);

/** The kind of a ref, also for older refs that only have a role. */
export const kindOf = (r: { kind?: string; role: "style" | "character" }): RefKind => (byId.has(r.kind as RefKind) ? (r.kind as RefKind) : r.role === "style" ? "style" : "person");

/** The order photos are handed to an image-to-image workflow: the person first, the look last. */
export const KIND_ORDER: RefKind[] = ["person", "outfit", "product", "location", "pose", "prop", "other", "palette", "style"];
export const kindRank = (r: { kind?: string; role: "style" | "character" }) => KIND_ORDER.indexOf(kindOf(r));
