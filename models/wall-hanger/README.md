# Wall hanger (Blender model)

Oak coat rail (1.20 m, top edge at 1.72 m) with five hooks, a backpack and motorcycle trousers.
Blender 5 model `wall_hanger.blend` (no build script).

## Web model (`web/wall_hanger.glb`)

Used by `index.html` (GLTFLoader + DRACOLoader). Rebuild from the `.blend`:

```
blender -b models/wall-hanger/wall_hanger.blend -P models/wall-hanger/source/export_glb.py
npx @gltf-transform/cli draco models/wall-hanger/web/wall_hanger-raw.glb models/wall-hanger/web/wall_hanger.glb
```

The studio's back wall curves into the floor, so the export cuts the 5 m wall down to a freestanding
panel (1.60 x 2.10 m, two feet at the back) with the skirting board. It drops floor, lights and camera,
clears the parents, joins the parts per material and decimates every material mesh above 2,500 triangles
(201k -> ~42k triangles; the trousers alone had ~106k). The oak grain is baked into a 512 px JPEG; the
noise bump maps of the fabrics are dropped. Y-up metres, origin on the floor at the centre of the panel's
front face. ~1.0 MB raw, ~0.17 MB with Draco. `review/web_preview.png` shows the web model in Three.js.
