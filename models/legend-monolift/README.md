# Legend Monolift + Eleiko Powerbar, 225 kg (Blender model)

Procedural Blender 5 model, built by `source/build_monolift.py` (bpy only, no external assets).
Context: test rig for the [Barbellscan](https://github.com/NicoFuchsGIT/Barbellscan) bar-deflection project.

## Rebuild

```
blender -b -P models/legend-monolift/source/build_monolift.py
```

Writes `monolift.blend` and `render_{iso,front,bar,scan}.png` next to the script's working directory.
The script asserts the loaded mass is 225 kg (25 kg bar + 4 x 50 kg... see `N` in the script) and that plates fit between the uprights.

## Contents

- Legend Monolift (Model 3908 layout): uprights with 25 holes, pegs, J-hooks at +-371 mm, base frame.
- Eleiko Powerbar (1310 mm shaft, 2200 mm total), IPF 25 kg-class discs (450 mm), IPF collars.
- Barbellscan markers: yellow 70 mm balls on black bell caps, yellow centre tape.
- Backdrop board 2.60 x 1.00 m behind the bar: millimetre paper (centre line + bar axis) and ArUco DICT_4X4_50 id 0.

## Known limits

- ArUco bit pattern was written from memory and not verified with OpenCV.
- Marker plane is ~0.23 m behind the bar (depth-offset risk, PRD section 12).
- Dimensions of the collar and hooks are estimates from photos; Legend figures are from the product page.
- Barbellscan detection defaults (magenta tape, 50 mm balls) are not updated for yellow tape / 70 mm balls.
- Renders in `review/` are Cycles 64 samples; mm lines are sub-pixel in the scan view.
