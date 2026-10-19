"""Export spikeball_titan.blend as a web model (spikeball-raw.glb) for the Three.js studio.
Run: blender -b models/spikeball-titan/spikeball_titan.blend -P models/spikeball-titan/source/export_glb.py

Drops the render set (floor, light, camera, camera target), bakes the Atlas ball's procedural rings
into a texture, converts curves (net cords) and text to mesh, applies bevels / booleans and joins the
parts per material, so the page gets ~10 draw calls.
Output: ../web/spikeball-raw.glb (compress it to spikeball.glb with gltf-transform, see README),
Y-up, metres, origin at the floor centre (feet on y = 0).
"""
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
if not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "..", "spikeball_titan.blend"))
OUT = os.path.join(HERE, "..", "web", "spikeball-raw.glb")
ctx = bpy.context
scene = ctx.scene

# --- Atlas-Ball: Ring-Muster in eine Textur backen --------------------------
ball = bpy.data.objects["Atlas_Ball"]
mat = ball.data.materials[0]
nt = mat.node_tree
img = bpy.data.images.new("Atlas_Ball_albedo", 512, 256)
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
nt.nodes.active = tex
scene.render.engine = 'CYCLES'
scene.cycles.samples = 4
bpy.ops.object.select_all(action='DESELECT')
ball.select_set(True); ctx.view_layer.objects.active = ball
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=4)
img.pack()
bsdf = nt.nodes["Principled BSDF"]
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

# --- Render-Set entfernen ---------------------------------------------------
set_col = bpy.data.collections["Spikeball_Titan_Set"]
for ob in list(bpy.data.objects):
    if ob.name not in set_col.objects:
        bpy.data.objects.remove(ob)

# Kurven / Text -> Mesh, Modifier einbacken (Hilfsobjekte muessen dafuer noch existieren)
helpers = [ob for ob in set_col.objects if ob.hide_render]
parts = [ob for ob in set_col.objects if not ob.hide_render]
for ob in parts:
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); ctx.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
for ob in helpers:
    bpy.data.objects.remove(ob)

# Pro Material zusammenfassen
by_mat = {}
for ob in list(set_col.objects):
    by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
for name, obs in by_mat.items():
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    ctx.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    obs[0].name = f"Spikeball_{name}"

tris = sum(len(p.vertices) - 2 for ob in set_col.objects for p in ob.data.polygons)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_yup=True)
print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB,", len(set_col.objects), "meshes,", tris, "tris")
