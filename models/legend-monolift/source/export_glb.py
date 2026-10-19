"""Export monolift.blend as a web model (monolift.glb) for the Three.js studio.
Run: blender -b models/legend-monolift/monolift.blend -P models/legend-monolift/source/export_glb.py
(or with the bpy wheel: python export_glb.py, it opens the .blend itself)

Drops the render set (floor, wall, lights, cameras), converts the text to mesh, applies the bevels
and joins every group's parts per material, so the page gets ~20 draw calls instead of ~400.
Procedural node materials (knurl bump, millimetre paper) do not survive glTF: they export as flat colours.
Output: ../web/monolift-raw.glb (compress it to monolift.glb with gltf-transform, see README), Y-up, metres, lifter side facing +Z, origin at the floor centre.
"""
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
if not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "..", "monolift.blend"))
OUT = os.path.join(HERE, "..", "web", "monolift-raw.glb")

GROUPS = ("Monolift", "Barbell_225kg")
keep = set()
for g in GROUPS:
    keep.add(bpy.data.objects[g])
    keep.update(bpy.data.objects[g].children_recursive)
for ob in list(bpy.data.objects):
    if ob not in keep:
        bpy.data.objects.remove(ob)

ctx = bpy.context
for g in GROUPS:
    root = bpy.data.objects[g]
    kids = list(root.children)
    # text -> mesh, then bake modifiers into the mesh data
    for ob in kids:
        ctx.view_layer.objects.active = ob
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.ops.object.convert(target='MESH')
    kids = list(root.children)
    by_mat = {}
    for ob in kids:
        by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
    for name, obs in by_mat.items():
        bpy.ops.object.select_all(action='DESELECT')
        for ob in obs:
            ob.select_set(True)
        ctx.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        obs[0].name = f"{g}_{name}"

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_yup=True)
print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB")
