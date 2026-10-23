# Bed (woodworking project, Blender model)

Solid wood platform bed with headboard, built after photos of the real bed. Shown in the window of the
woodworking object (`windowModel` in content/objects.json), not in the studio itself. Procedural Blender 5
model, `source/build_bed.py` (bpy only). Dimensions are estimates (mattress 140 x 200 cm).

- Slatted base: 21 dark stained slats across the bed, cross lap joints with three longitudinal rails.
  Slat and rail are each notched to half the slat thickness (2 cm), so the tops sit flush. The notches are
  real geometry (segments), the light rail wood shows between the slats like on the photos.
- Six square legs (7 x 7 cm), slat top at 30 cm.
- Headboard of six horizontal boards, shelf on top, side panel on the right; it reaches 22 cm past the bed.

## Rebuild

```
blender -b -P models/bed/source/build_bed.py
npx @gltf-transform/cli draco models/bed/web/bed-raw.glb models/bed/web/bed.glb
```

Writes `bed.blend` and `web/bed-raw.glb`: the wood grain (wave texture in object coordinates, along the
boards) is baked into 1024 px JPEGs on Smart-UV-projected meshes. Y-up metres, origin on the floor at the
centre of the slatted base, foot end towards +Z. ~12.5k triangles, ~0.28 MB with Draco.
`review/web_preview.png` shows the web model in the window.
