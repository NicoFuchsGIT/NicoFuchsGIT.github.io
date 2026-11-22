"""Export wall_hanger.blend as a web model (wall_hanger-raw.glb) for the Three.js studio.
Run: blender -b models/wall-hanger/wall_hanger.blend -P models/wall-hanger/source/export_glb.py

The wall itself comes from the studio (`wall` in content/objects.json), so the export drops the wall and
the skirting board together with floor, lights and camera,
clears the parents (Rucksack, Motorradhose), decimates the dense cloth meshes (201k -> ~40k triangles, trousers alone ~106k)
and joins the parts per material. The oak grain is baked into a texture; the noise bump maps of the
fabrics are dropped (glTF has no procedural textures). Output: ../web/wall_hanger-raw.glb (compress with
gltf-transform, see README), Y-up metres, origin on the floor below the rail, on the wall surface (the parts hang towards +Z).
"""
import bpy, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
if not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "..", "wall_hanger.blend"))
OUT = os.path.join(HERE, "..", "web", "wall_hanger-raw.glb")
ctx = bpy.context
scene = ctx.scene
KEEP_TRIS = 2500           # pro Material: bis hierhin bleibt alles, darueber bleiben 6 % des Rests

def select_only(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    ctx.view_layer.objects.active = obs[0]

# --- Boden, Licht, Kamera raus, Eltern loesen -------------------------------
for ob in list(bpy.data.objects):
    if ob.type in ('LIGHT', 'CAMERA') or ob.name == "Boden":
        bpy.data.objects.remove(ob)
for ob in bpy.data.objects:
    if ob.parent:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
for ob in [o for o in bpy.data.objects if o.type == 'EMPTY']:
    bpy.data.objects.remove(ob)

# --- Wand und Sockelleiste raus: der Haenger kommt an die Wand im Studio (objects.json `wall`) ---
for name in ("Wand", "Sockelleiste"):
    bpy.data.objects.remove(bpy.data.objects[name])

# --- Modifier und Kurven einbacken -------------------------------------------
parts = [ob for ob in bpy.data.objects if ob.type in ('MESH', 'CURVE', 'FONT')]
select_only(parts)
bpy.ops.object.convert(target='MESH')
parts = [ob for ob in bpy.data.objects if ob.type == 'MESH']

# --- Bump-Maps entfernen ------------------------------------------------------
for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf:
        for link in list(bsdf.inputs["Normal"].links):
            nt.links.remove(link)

# --- Pro Material zusammenfassen und dezimieren -------------------------------
by_mat = {}
for ob in parts:
    key = "+".join(m.name for m in ob.data.materials)
    by_mat.setdefault(key, []).append(ob)
meshes = []
for name, obs in by_mat.items():
    select_only(obs)
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = obs[0]
    ob.name = f"Wandhaenger_{name}"
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > KEEP_TRIS:
        mod = ob.modifiers.new("Decimate", 'DECIMATE')
        mod.ratio = (KEEP_TRIS + 0.06 * (tris - KEEP_TRIS)) / tris
        select_only([ob])
        bpy.ops.object.modifier_apply(modifier=mod.name)
    meshes.append(ob)

# Transformationen anwenden, damit die Huellboxen in Three.js genau sind
select_only(meshes)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- Prozedurale Farben (Eiche, ggf. weitere) in Texturen backen ------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = 4
for ob in meshes:
    for mat in ob.data.materials:
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        if not bsdf.inputs["Base Color"].links:
            continue
        select_only([ob])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
        bpy.ops.object.mode_set(mode='OBJECT')
        img = bpy.data.images.new(f"{mat.name}_albedo", 512, 512)
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
        nt.nodes.active = tex
        metal = bsdf.inputs["Metallic"].default_value
        bsdf.inputs["Metallic"].default_value = 0.0
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=4)
        bsdf.inputs["Metallic"].default_value = metal
        img.pack()
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        print("BAKED", mat.name)

# --- Ursprung: Boden, Mitte der Plattenvorderseite (y = 0) ------------------
tris = sum(len(p.vertices) - 2 for ob in meshes for p in ob.data.polygons)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_yup=True,
                          export_image_format='JPEG')
print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB,", len(meshes), "meshes,", tris, "tris")
