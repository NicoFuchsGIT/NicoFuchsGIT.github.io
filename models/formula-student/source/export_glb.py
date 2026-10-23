"""Export formula_student.blend as a web model (formula_student-raw.glb) for the Three.js studio.
Run: blender -b models/formula-student/formula_student.blend -P models/formula-student/source/export_glb.py

Drops the render set (collection "Umgebung": floor cove, lights, cameras), moves the wings to
rule-conform positions (front wing max. 0.70 m ahead of the front tyres, rear wing max. 0.25 m behind
the rear tyres), converts curves and the start numbers to meshes and joins the parts per material.
The livery (blue / white stripe / carbon, driven by object coordinates) is baked into a texture; the
carbon weave is too fine for the web and becomes a flat dark clear-coated colour.
Output: ../web/formula_student-raw.glb (compress with gltf-transform, see README), Y-up metres,
origin on the floor between the axles, driving direction +X.
"""
import bpy, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
if not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "..", "formula_student.blend"))
OUT = os.path.join(HERE, "..", "web", "formula_student-raw.glb")
ctx = bpy.context
scene = ctx.scene
CARBON_RGB = (0.025, 0.025, 0.028, 1)

def select_only(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    ctx.view_layer.objects.active = obs[0]

# --- Render-Set entfernen ---------------------------------------------------
for ob in list(bpy.data.collections["Umgebung"].objects):
    bpy.data.objects.remove(ob)

# --- Fluegel regelkonform: vorn 0,10 m zurueck, hinten 0,35 m nach vorn -----
for ob in bpy.data.objects:
    if ob.name.startswith("Frontfluegel"):
        ob.location.x -= 0.10
    elif ob.name.startswith("Heckfluegel"):
        ob.location.x += 0.35

# --- Carbon: Koeper-Schachbrett raus, flache Farbe --------------------------
for name in ("Carbon", "Carbon_matt"):
    nt = bpy.data.materials[name].node_tree
    bsdf = nt.nodes["Principled BSDF"]
    for link in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(link)
    bsdf.inputs["Base Color"].default_value = CARBON_RGB
livery = bpy.data.materials["Lackierung"].node_tree
mix = [n for n in livery.nodes if n.type == 'MIX'][-1]          # Lack <-> Carbon
for link in list(mix.inputs["B"].links):
    livery.links.remove(link)
mix.inputs["B"].default_value = CARBON_RGB

# --- Modifier und Kurven einbacken, pro Material zusammenfassen -------------
parts = [ob for ob in bpy.data.objects if ob.type in ('MESH', 'CURVE', 'FONT')]
select_only(parts)
bpy.ops.object.convert(target='MESH')
parts = [ob for ob in bpy.data.objects if ob.type == 'MESH']
by_mat = {}
for ob in parts:
    by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
meshes = []
for name, obs in by_mat.items():
    select_only(obs)
    if len(obs) > 1:
        bpy.ops.object.join()
    obs[0].name = f"FS_{name}"
    meshes.append(obs[0])

# Transformationen anwenden, damit die Huellboxen in Three.js genau sind
select_only(meshes)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- Lackierung backen (die Teile liegen alle im Ursprung) -----------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = 4
ob = bpy.data.objects["FS_Lackierung"]
select_only([ob])
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
bpy.ops.object.mode_set(mode='OBJECT')
img = bpy.data.images.new("Lackierung_albedo", 1024, 1024)
tex = livery.nodes.new("ShaderNodeTexImage"); tex.image = img
livery.nodes.active = tex
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=4)
img.pack()
bsdf = livery.nodes["Principled BSDF"]
livery.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

tris = sum(len(p.vertices) - 2 for ob in meshes for p in ob.data.polygons)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_yup=True,
                          export_image_format='JPEG')
print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB,", len(meshes), "meshes,", tris, "tris")
