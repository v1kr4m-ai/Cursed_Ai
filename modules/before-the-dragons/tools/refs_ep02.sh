#!/usr/bin/env bash
# Episode 2 "The Long Night" reference stills.
# Queues behind whatever the H3 batch is currently running.
set -u

cd "D:/Claude/In_Progress/02_Web_Apps/Cursed_Ai/modules/before-the-dragons" || exit 1

still () {
  local name=$1 seed=$2 prompt=$3 neg=$4
  echo "=== $name $(date +%H:%M:%S)"
  python tools/comfy_h3.py still "$name" "$prompt" --neg "$neg" --seed "$seed"
}

BASENEG="cartoon, anime, illustration, painting, cgi, 3d render, plastic skin, text, watermark, logo, deformed hands, extra limbs, blurry, oversaturated"

still ep02_style_plate 41 \
"cinematic film still, vertical composition, a frozen northern wilderness at deep dusk under a starless black sky, deep snow drifts and skeletal dead trees, blue-grey moonlight, heavy falling snow, freezing fog, desaturated cold color grade crushed toward blue and black, shallow depth of field, anamorphic lens, 35mm film grain, no people, bleak documentary realism" \
"$BASENEG, warm light, sunset, green foliage, summer"

still ep02_other 42 \
"cinematic film still, vertical composition, a tall gaunt humanoid figure standing in deep snow at night, translucent pale blue-white skin stretched over sharp bone, ice-crystal armour that reflects the surroundings like a mirror, piercing luminous ice-blue eyes, long thin frost-covered sword of clear ice, seen at middle distance half-obscured by falling snow and freezing fog, cold blue moonlight, desaturated blue-black grade, photoreal practical creature effect, 35mm film grain, full body" \
"$BASENEG, skeleton, zombie, orc, armour plate metal, glowing red eyes, human face, beard"

still ep02_wight 43 \
"cinematic film still, vertical composition, a column of frost-covered reanimated corpses marching through deep snow at night, grey-blue frozen flesh, torn ancient furs and rusted mail, pale glowing blue eyes, blank expressions, ragged column stretching back into blizzard haze, low camera angle, cold blue-black desaturated grade, falling snow, photoreal practical makeup effects, 35mm film grain" \
"$BASENEG, modern zombie makeup, blood gore, running, snarling faces, warm light"

still ep02_last_hero 44 \
"cinematic film still, vertical composition, a lone weary warrior struggling up a snow ridge in a blizzard, heavy frost-caked furs and dented bronze scale armour, hood up, ice in the beard, leading an exhausted horse by the reins, broken sword at the hip, dim blue twilight, whiteout snow, desaturated cold grade, photoreal, 35mm film grain, full body wide shot" \
"$BASENEG, clean armour, heroic pose, shining sword, castle background, warm light"

still ep02_wall 45 \
"cinematic film still, vertical composition, a colossal wall of solid ice seven hundred feet tall stretching from horizon to horizon across a frozen landscape, sheer weathered blue-white ice face streaked with snow, tiny human figures on the top edge for scale, low grey overcast sky, cold desaturated blue grade, aerial wide shot, volumetric haze, photoreal, 35mm film grain" \
"$BASENEG, glacier only, mountain, castle, fantasy city, warm light"

echo "=== EP02 REFS COMPLETE $(date +%H:%M:%S)"
ls -la reels/pre-targaryen/refs/ep02_*.png
