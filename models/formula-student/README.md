# Formula Student car (Blender model)

Electric Formula Student car, loosely based on the EDGE cars of TU Wien Racing. Procedural Blender 5 model,
built by `source/build_formula_student.py` (bpy only, no external assets). Wheelbase 1.55 m, track
1.22 m front / 1.18 m rear, 10-inch wheels (tyre 0.41 m). Dimensions are estimates of a typical FS car,
not design data.

## Rebuild

```
blender -b -P models/formula-student/source/build_formula_student.py
```

Writes `formula_student.blend` and `review/render_*.png` (Cycles, 128 samples; `WB_SAMPLES` overrides,
`WB_NORENDER=1` skips the renders).

## Web model (`web/formula_student.glb`)

Used by `index.html` (GLTFLoader + DRACOLoader). Rebuild from the `.blend`:

```
blender -b models/formula-student/formula_student.blend -P models/formula-student/source/export_glb.py
npx @gltf-transform/cli draco models/formula-student/web/formula_student-raw.glb models/formula-student/web/formula_student.glb
```

The export drops the render set (cove, lights, cameras) and moves the wings to rule-conform positions:
front wing 0.10 m back (max. 0.70 m ahead of the front tyres), rear wing 0.35 m forward (max. 0.25 m
behind the rear tyres). Curves and start numbers become meshes, parts are joined per material (16 meshes).
The livery is baked into a 1024 px JPEG; the carbon weave is too fine for the web and becomes a flat dark
clear-coated colour. Y-up metres, origin on the floor between the axles, driving direction +X.
Overall 2.93 x 1.42 x 1.21 m, ~35k triangles, 1.1 MB raw, ~0.17 MB with Draco.
`review/web_preview.png` shows the web model in Three.js.
