"""Export printtable.blend as a web model (printtable-raw.glb) for the Three.js studio.
Run: blender -b models/3d-printing/printtable.blend -P models/3d-printing/source/export_glb.py

Drops the render set (collection "Umgebung": floor, wall, lights, cameras), applies bevels, solidify and
the PTFE tube curves and joins the parts per material. The procedural materials (walnut grain, PEI
plate) are baked into textures, since glTF only carries image textures. Glass and the orange covers
use Cycles transmission; they are exported as alpha-blended materials, which Three.js draws cheaply.
Output: ../web/printtable-raw.glb (compress it to printtable.glb with gltf-transform, see README),
Y-up, metres, origin at the floor centre of the table.
"""
import bpy, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
if not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "..", "printtable.blend"))
OUT = os.path.join(HERE, "..", "web", "printtable-raw.glb")
ctx = bpy.context
scene = ctx.scene
TEX_SIZE = {"Nussbaum_X": 2048}   # Rest 512
ALPHA = {"Glas_rauch": 0.25, "AMS_Deckel": 0.35, "Haube_orange": 0.55, "PTFE_Schlauch": 0.6}

def select_only(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    ctx.view_layer.objects.active = obs[0]

# --- Render-Set entfernen ---------------------------------------------------
for ob in list(bpy.data.collections["Umgebung"].objects):
    bpy.data.objects.remove(ob)

# --- Modifier/Kurven einbacken, pro Material zusammenfassen -----------------
parts = [ob for ob in bpy.data.objects if ob.type in ('MESH', 'CURVE')]
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
    obs[0].name = f"Drucktisch_{name}"
    meshes.append(obs[0])

# --- Prozedurale Materialien in Texturen backen -----------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = 4
for ob in meshes:
    mat = ob.data.materials[0]
    nt = mat.node_tree
    if not any(n.type == 'VALTORGB' for n in nt.nodes):
        continue
    select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    size = TEX_SIZE.get(mat.name, 512)
    img = bpy.data.images.new(f"{mat.name}_albedo", size, size)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.nodes.active = tex
    bsdf = nt.nodes["Principled BSDF"]
    metal = bsdf.inputs["Metallic"].default_value
    bsdf.inputs["Metallic"].default_value = 0.0      # sonst liefert der Diffuse-Pass bei Metall kaum Farbe
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=4)
    bsdf.inputs["Metallic"].default_value = metal
    img.pack()
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    for link in list(bsdf.inputs["Normal"].links):    # Bump aus Rauschen kennt glTF nicht
        nt.links.remove(link)
    print("BAKED", mat.name, size)

# --- Glas: Transmission -> Alpha-Blending -----------------------------------
for name, alpha in ALPHA.items():
    mat = bpy.data.materials[name]
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Transmission Weight"].default_value = 0.0
    bsdf.inputs["Alpha"].default_value = alpha
    mat.surface_render_method = 'BLENDED'

# --- Ursprung in die Mitte der Grundflaeche ---------------------------------
xs, ys = [], []
for ob in meshes:
    for v in ob.data.vertices:
        w = ob.matrix_world @ v.co
        xs.append(w.x); ys.append(w.y)
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
for ob in meshes:
    ob.location.x -= cx
    ob.location.y -= cy

tris = sum(len(p.vertices) - 2 for ob in meshes for p in ob.data.polygons)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_yup=True,
                          export_image_format='JPEG')
print("WROTE", OUT, os.path.getsize(OUT) // 1024, "KB,", len(meshes), "meshes,", tris, "tris,",
      f"size {max(xs) - min(xs):.2f} x {max(ys) - min(ys):.2f} m, shifted by ({-cx:.3f}, {-cy:.3f})")
