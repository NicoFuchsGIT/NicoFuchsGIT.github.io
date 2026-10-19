# 3D-Druck: Drucktisch mit Bambu Lab H2D und Formlabs Form 4 (Blender model)

Procedural Blender 5 model, built by `source/build_printtable.py` (bpy only, no external assets).
FDM printer with AMS on the left, resin printer in the middle, Form Wash and Form Cure on the right;
table top at 0.75 m.

## Rebuild

```
blender -b -P models/3d-printing/source/build_printtable.py
```

Writes `printtable.blend` and `review/render_schraeg.png` / `review/render_front.png` (Cycles, 128 samples;
`WB_SAMPLES` overrides, `WB_NORENDER=1` skips the renders).

## Web model (`web/printtable.glb`)

Used by `index.html` (GLTFLoader + DRACOLoader). Rebuild from the `.blend`:

```
blender -b models/3d-printing/printtable.blend -P models/3d-printing/source/export_glb.py
npx @gltf-transform/cli draco models/3d-printing/web/printtable-raw.glb models/3d-printing/web/printtable.glb
```

The export drops the render set (floor, wall, lights, cameras), applies bevels, solidify and the PTFE tube
curves, and joins the parts per material (42 meshes). The walnut grain and the PEI plate are baked into
JPEG textures (2048 px / 512 px) on Smart-UV-projected meshes. Glass doors, the AMS lid and the orange
covers use transmission in Cycles and are exported as alpha-blended materials. Y-up metres, origin at the
floor centre of the table. ~34k triangles, 1.6 MB raw, ~0.45 MB with Draco.

## Contents

- Table: walnut top 1.90 x 0.80 m on a black steel frame, lower shelf with filament spools, two resin
  cartridges and a box; wall shelf with nine spools. Props: scraper, flush cutter, IPA bottle, glove box,
  spare spool.
- Bambu Lab H2D (492 x 514 x 626 mm): glass door and lid, build chamber with bed and PEI plate, Z screws,
  gantry, dual-nozzle toolhead, LED strip, touchscreen; AMS 2 Pro on top with four spools and PTFE tubes
  to the back.
- Formlabs Form 4 (about 398 x 367 x 554 mm): grey base with touchscreen, orange cover, resin tank,
  Z tower with build platform and a hanging part, cartridge at the back. Form Wash and Form Cure next to it.

## Known limits

- Outer dimensions follow the manufacturer specs; details are estimates. The H2D touchscreen position is
  a guess.
- No brand logos or text on the devices.
