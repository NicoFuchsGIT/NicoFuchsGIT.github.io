# Wall hanger (Blender model)

Oak coat rail (1.20 m, top edge at 1.72 m) with five hooks, a backpack and motorcycle trousers.
Blender 5 model `wall_hanger.blend` (no build script).

## Web model (`web/wall_hanger.glb`)

Used by `index.html` (GLTFLoader + DRACOLoader). Rebuild from the `.blend`:

```
blender -b models/wall-hanger/wall_hanger.blend -P models/wall-hanger/source/export_glb.py
node models/tools/web-optimize.mjs models/wall-hanger/web/wall_hanger-raw.glb models/wall-hanger/web/wall_hanger.glb
```

The wall comes from the studio (`wall` in content/objects.json), so the export drops the wall and the
skirting board together with floor, lights and camera. It clears the parents, joins the parts per
material and decimates every material mesh above 2,500 triangles (201k -> ~42k triangles; the trousers
alone had ~106k). The oak grain is baked into a 512 px JPEG; the noise bump maps of the fabrics are
dropped. Y-up metres, origin on the floor below the centre of the rail, on the wall surface. ~1.0 MB raw. The
web step (`models/tools`) merges the plain colours into one palette material: 2 draw calls, ~0.15 MB.
