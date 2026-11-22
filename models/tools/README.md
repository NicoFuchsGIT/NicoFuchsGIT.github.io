# Web step for the models

`web-optimize.mjs` turns a Blender export (`web/*-raw.glb`) into the `.glb` the page loads. It replaces the
earlier `npx @gltf-transform/cli draco raw.glb web.glb` step; each model README has the exact command.

```
cd models/tools && npm install      # once
node models/tools/web-optimize.mjs <in.glb> <out.glb> [--keep A,B] [--simplify Material=0.001] [--max-texture 1024]
node models/tools/web-optimize.mjs <web.glb> <web.glb> --textures-only [--max-texture 512]
```

What it does, in order:

1. `--simplify Material=error`: reduces the triangles of the parts with that material (meshoptimizer). The
   error is a fraction of the part's size; 0.001 on the 1.2 m Spikeball net is about 1 mm.
2. Scales textures above `--max-texture` (default 1024 px) down and turns JPEG textures into WebP (quality
   80, roughly half the size; `EXT_texture_webp`, which three.js reads). PNGs stay PNG: palettes and markers
   must be lossless. Models that are only seen from the studio camera use `--max-texture 512`.
3. Merges plain-coloured materials into one material with small palette textures and joins the parts that
   share a material, so each model costs only a few draw calls. Textured and transparent materials stay as
   they are, and so do the names given with `--keep`: the `decals` from `content/objects.json`, which the page
   finds by material name.
4. Bakes the node transforms into the vertices, so the boxes the page measures (click target, shadow,
   wall and table placement) fit the model tightly.
5. Draco compression with 16-bit positions (the default 14 bits are too coarse for a decal 0.2 mm in
   front of a joined 2.6 m part).

`--textures-only` runs just step 2 on a `.glb` that is already prepared for the web and leaves the geometry
as it is. The car and the bed are compressed with the plain Draco command and get their WebP textures this way.

Uses @gltf-transform 4.5.1, the same version as before.
