# Spikeball Titan (procedural Three.js model)

Rebuilt from a single product photo (`review/reference.png`) with the
[img2threejs](https://www.npmjs.com/package/img2threejs) pipeline. No mesh was downloaded or
extracted: the model is generated in code from `source/object-sculpt-spec.json`.

## Use

```js
import { createSpikeballModel, pickableMeshes, partIdFromObject, setExplode, applyEnvironment }
  from './models/spikeball-titan/spikeball-model.js';   // needs the import map's "three"

const model = createSpikeballModel();   // THREE.Group, ~0.93 m wide, feet on y = 0
scene.add(model);
pickableMeshes(model);                  // raycast targets (58 meshes)
partIdFromObject(model, hit.object);    // -> "foot-s", "bracket-wall-n", "rim-band", ...
setExplode(model, 0..1);                // scales the part layout about the centre
model.userData.sculptRuntime;           // nodes / meshes / sockets / colliders / destructionGroups
```

Textures are loaded from `pbr/` (relative to the page URL). 55 named components, ~41k triangles,
59 draw calls.

## What is faithful, what is not

- Faithful: ring + wall proportions, 4 plate brackets and 4 wedge feet at 90 degrees, yellow/black
  split (colours measured from the photo), pose, moulded-plastic response.
- Stylised: the net is a web of rings and radial cords (the photo has a diamond mesh); lettering
  (`Spikeball`, `TITAN`, the S roundel) is built from blocks/ring, not real glyphs.
- Inferred (not visible in the photo): the far feet and the underside, from 4-fold symmetry.
- Silhouette IoU is measured against a hole-filled version of the reference (the photographed net
  is see-through); against the raw photo it is ~0.67. The review history is in the spec.

## Provenance scripts

`source/` keeps the scripts that produced the model (`build_spec.py`, `rebuild.sh`, `bundle.sh`) for
reference. They assume the original working directory (reference crops, intake `assessment.json`)
and the img2threejs skill, so they are not runnable standalone. `bundle.sh` shows how
`source/entry.ts` + the generated `createObjectModel.ts` become `spikeball-model.js`.
