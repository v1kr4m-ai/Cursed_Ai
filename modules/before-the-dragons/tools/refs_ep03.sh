#!/usr/bin/env bash
# Episode 3 "The Empire of Chains" reference stills.
# Ghis is hot and arid: the grade shifts from blue-crushed to sun-bleached
# red-brown while keeping the series' desaturation and haze.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

still () {
  local name=$1 seed=$2 prompt=$3 neg=$4
  echo "=== $name $(date +%H:%M:%S)"
  python tools/comfy_h3.py still "$name" "$prompt" --neg "$neg" --seed "$seed"
}

BASENEG="cartoon, anime, illustration, painting, cgi, 3d render, plastic skin, text, watermark, logo, deformed hands, extra limbs, blurry, oversaturated"

still ep03_style_plate 61 \
"cinematic film still, vertical composition, a harsh arid coastline of red-brown earth and dust under a white midday sun, dry scrub and bare rock, heavy heat haze shimmering on the horizon, desaturated sun-bleached color grade with deep hard shadows, anamorphic lens, 35mm film grain, no people, bleak documentary realism" \
"$BASENEG, snow, ice, blue tones, lush green, rain, night"

still ep03_ghis_city 62 \
"cinematic film still, vertical composition, an ancient colossal city of stepped mud-brick pyramids and terraced ziggurats rising above a harbour, weathered red-brown brickwork, narrow streets between massive terraces, hazy golden hour light, dust in the air, aerial wide shot, desaturated sun-bleached grade, photoreal, 35mm film grain" \
"$BASENEG, egyptian pyramids smooth sided, greek columns, medieval european castle, modern buildings, snow"

still ep03_legionary 63 \
"cinematic film still, vertical composition, an ancient heavy infantry soldier standing at attention in dusty sunlight, bronze scale armour over a dark tunic, tall rectangular shield, crested bronze helmet with cheek guards, long spear, dark curled beard, sun-weathered skin, dust on the armour, desaturated sun-bleached grade, photoreal, 35mm film grain, full body" \
"$BASENEG, roman legionary red cape, medieval knight, plate armour, viking, fantasy armour, horns on helmet"

still ep03_slave 64 \
"cinematic film still, vertical composition, a gaunt labourer standing in harsh sunlight wearing a rough undyed loincloth and a heavy iron collar with a short chain, dust-caked skin, visible ribs, calloused hands, exhausted blank expression, brick quarry background out of focus, desaturated sun-bleached grade, photoreal, 35mm film grain, full body" \
"$BASENEG, clean skin, muscular hero physique, jewellery, modern clothing, chains as fashion, snow"

still ep03_volcano 65 \
"cinematic film still, vertical composition, a bleak volcanic peninsula of black lava rock and grey ash slopes at dawn, several smoking cones on the horizon, jagged broken basalt in the foreground, thin sulphur haze, desaturated grade with faint warm glow at the peaks, wide landscape shot, photoreal, 35mm film grain, no people" \
"$BASENEG, lush vegetation, snow, ocean beach resort, lava flow rivers bright orange, night"

still ep03_dragon 66 \
"cinematic film still, vertical composition, an enormous sleeping dragon coiled in a dark volcanic cave, lit only by a dull red glow from a floor fissure, matte black and dark bronze overlapping scales, long curved horns swept back, folded leathery wings, closed eye the size of a man's head, wet reflective scale texture, photoreal creature realism, heavy shadow, 35mm film grain" \
"$BASENEG, cute dragon, cartoon dragon, western heraldic dragon, bright colours, fire breathing, glowing body, wyvern toy"

echo "=== EP03 REFS COMPLETE $(date +%H:%M:%S)"
ls -la reels/pre-targaryen/refs/ep03_*.png
