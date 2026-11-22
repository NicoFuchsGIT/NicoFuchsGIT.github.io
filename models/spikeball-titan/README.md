# Spikeball Titan Set (Blender model)

Procedural Blender 5 model, built by `source/build_spikeball.py` (bpy only, no external assets).
Replaces the earlier img2threejs reconstruction.

## Rebuild

```
blender -b -P models/spikeball-titan/source/build_spikeball.py
```

Writes `spikeball_titan.blend` and `review/render_preview.png` (Cycles, 96 samples; `SB_SAMPLES` overrides).

## Web model (`web/spikeball.glb`)

Used by `index.html` (GLTFLoader + DRACOLoader). Rebuild from the `.blend`:

```
blender -b models/spikeball-titan/spikeball_titan.blend -P models/spikeball-titan/source/export_glb.py
node models/tools/web-optimize.mjs models/spikeball-titan/web/spikeball-raw.glb models/spikeball-titan/web/spikeball.glb \
  --simplify Netz=0.001
```

The export drops floor, light and camera, bakes the Atlas ball's procedural rings into a 512x256
texture, converts the net cords and lettering to mesh and joins the parts per material (6 meshes).
Y-up metres, origin at the floor centre. ~382k triangles (332k in the net), 12.6 MB raw. The web step
(`models/tools`) reduces the net to ~37k triangles (about 1 mm deviation, cords and knots stay) and merges
the plain colours: ~88k triangles, 2 draw calls, ~290 KB. In the studio the whole box counts as click target
(`clickBox` in `content/objects.json`), because clicks would otherwise fall through the net holes.

## Contents

- Yellow frame with triangular profile (inner edge 0.455 m radius), 5 black connector sleeves with
  `TITAN` lettering, `Spikeball` lettering on the band.
- 5 snap-in block legs with triangular window, rubber sole and S roundel.
- Net of knotted cord (diamond mesh, 30 mm), pulled over the top edge, down the outside of the band and
  folded under the bottom edge, where a hem cord is held by 72 hooks (none at the legs).
- 1 Atlas ball (18 % larger, yellow/black) on the net, 1 Pro ball next to the ring.

## Known limits

- Dimensions are estimates, not manufacturer figures.
- Lettering is a default font, not the Spikeball logo type.
