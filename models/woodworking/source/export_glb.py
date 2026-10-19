"""Export workshop.blend as a web model (workshop-raw.glb) for the Three.js studio.
Run: blender -b models/woodworking/workshop.blend -P models/woodworking/source/export_glb.py

Drops the render set (collection "Umgebung": floor, walls, lights, cameras), clears the handwheel
parents, applies bevels and joins the parts per material. The procedural materials (wood grain,
pegboard holes, measuring tape, cast iron) are baked into textures, since glTF only carries image
textures. Output: ../web/workshop-raw.glb (compress it to workshop.glb with gltf-transform, see README),
Y-up, metres, origin at the floor centre of the whole set (saw + bench).
"""
import bpy, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
if not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "..", "workshop.blend"))
OUT = os.path.join(HERE, "..", "web", "workshop-raw.glb")
ctx = bpy.context
scene = ctx.scene
TEX_SIZE = {"Nussbaum_X": 2048, "Lochwand": 2048}   # Rest 1024

def select_only(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    ctx.view_layer.objects.active = obs[0]

# --- Render-Set entfernen, Eltern loesen ------------------------------------
for ob in list(bpy.data.collections["Umgebung"].objects):
    bpy.data.objects.remove(ob)
for ob in bpy.data.objects:
    if ob.parent:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
for ob in [o for o in bpy.data.objects if o.type == 'EMPTY']:
    bpy.data.objects.remove(ob)

# --- Modifier einbacken, pro Material zusammenfassen ------------------------
parts = [ob for ob in bpy.data.objects if ob.type == 'MESH']
select_only(parts)
bpy.ops.object.convert(target='MESH')
by_mat = {}
for ob in parts:
    by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
meshes = []
for name, obs in by_mat.items():
    select_only(obs)
    if len(obs) > 1:
        bpy.ops.object.join()
    obs[0].name = f"Werkstatt_{name}"
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
    size = TEX_SIZE.get(mat.name, 1024)
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
