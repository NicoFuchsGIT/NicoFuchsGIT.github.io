# Werkstatt: Werkbank + Tischkreissäge (Blender model)

Procedural Blender 5 model, built by `source/build_workshop.py` (bpy only, no external assets).
Table saw on the left, workbench with hutch on the right; both work surfaces at 0.92 m.

## Rebuild

```
blender -b -P models/woodworking/source/build_workshop.py
```

Writes `workshop.blend` and `review/render_schraeg.png` / `review/render_front.png` (Cycles, 96 samples;
`WB_SAMPLES` overrides, `WB_NORENDER=1` skips the renders).

## Web model (`web/workshop.glb`)

Used by `index.html` (GLTFLoader + DRACOLoader). Rebuild from the `.blend`:

```
blender -b models/woodworking/workshop.blend -P models/woodworking/source/export_glb.py
npx @gltf-transform/cli draco models/woodworking/web/workshop-raw.glb models/woodworking/web/workshop.glb
```

The export drops the render set (floor, walls, lights, cameras), applies bevels and joins the parts per
material (26 meshes). The procedural materials (wood grain in three directions for both wood tones,
pegboard holes, measuring tape, cast iron) are baked into JPEG textures (2048 px for the main walnut and
the pegboard, 1024 px otherwise) on Smart-UV-projected meshes. Y-up metres, origin at the floor centre
of the whole set. ~29k triangles, 2.6 MB raw, ~1.4 MB with Draco (mostly textures).

## Contents

- Workbench: walnut frame, top 2.00 x 0.77 m, 4 apron drawers, cabinet with 5 drawers (lighter wood),
  open shelves, back panel; hutch with 4 posts, pegboard, shelf, slatted top frame, black steel
  plates with screw heads. Props: hammer, screwdrivers, pliers, wrenches, spirit level, jars, boxes,
  tool cases, mallet, drawing.
- Table saw (cabinet type): cast-iron table with wings, two mitre slots, throat plate, 254 mm blade with
  48 carbide teeth (65 mm above the table), riving knife, rip fence on a rail with measuring tape,
  mitre gauge, height and tilt handwheels, switch, dust port, motor cover.

## Known limits

- Dimensions are estimates, not taken from a real bench or saw.
- No blade guard; the fence and mitre gauge are fixed in place.
