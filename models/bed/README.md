# Bed (woodworking project)

Solid wood platform bed with headboard, built after photos of the real bed. Shown in the window of the
woodworking object (`windowModel` in content/objects.json), not in the studio itself. Built in code by
`models/tools/build-bed.mjs` (no Blender needed). Dimensions are estimates (mattress 140 x 200 cm).

- Slatted base: 15 dark stained slats (7 x 4 cm, about 3 cm apart) running the full length of 2.02 m.
- They rest on two cross beams near the head and foot end, each on its own pair of square legs (7 x 7 cm),
  like two trestles. Slat top at 30 cm.
- Cross lap joints: slat and beam are each notched to half the slat thickness (2 cm), so the tops sit flush.
  The notches are real geometry; the light beam wood shows between the slats like on the photos.
- Headboard of six horizontal boards, shelf on top, back panel, side panel on the right. The slatted base is
  centred to it (1.74 m headboard, 12 cm wider than the base on each side).

## Rebuild

```
cd models/tools && npm install      # once
node models/tools/build-bed.mjs
```

Writes `web/bed.glb` directly (Draco, wood grain as generated 512 px WebP textures). Sizes are constants at
the top of the script. Y-up metres, origin on the floor at the centre of the slatted base, foot end towards
+Z. ~1.8k triangles, ~25 KB. `review/web_preview.png` shows the model in the window.
