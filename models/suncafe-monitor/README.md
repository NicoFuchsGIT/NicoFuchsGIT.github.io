# SunCafe screen (GLB for the 3D CV)

A large hanging display (65", 1.47 x 0.84 m) on two rods under a short ceiling rail, without a table. Bottom
edge 1.20 m above the floor, top of the rail 2.45 m, front towards +Z, origin on the floor below the centre.
Parts: `Display`, `Screen`, `Stange` (2x), `Schiene`.

`Screen` is a flat plane with an emissive material (`Screen_SunCafe`), so it stays readable without scene
lights. It lies 0.5 mm in front of the housing; the material name is listed as `decals` in
`content/objects.json`. Texture: `screen_suncafe.jpg` (screenshot of https://suncafe-nu.vercel.app/, Vienna,
"Morgen früh"), stored as WebP in the model.

Rebuild (no Blender needed, the model is built in code):

```
cd models/tools && npm install      # once
node models/tools/build-suncafe-screen.mjs
```

Sizes and heights are constants at the top of `models/tools/build-suncafe-screen.mjs`. To show another
screenshot, replace `screen_suncafe.jpg` (16:9) and rebuild.
