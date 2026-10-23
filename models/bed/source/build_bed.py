"""Platform bed with headboard (woodworking project), procedural, bpy only.
Run: blender -b -P models/bed/source/build_bed.py
Writes ../bed.blend and ../web/bed-raw.glb (compress with gltf-transform, see README).

Built after photos of the real bed; dimensions are estimates (mattress 140 x 200 cm):
- Slatted base: 21 dark stained slats across the bed, joined to three longitudinal rails with cross
  lap joints. Slat and rail are each notched to half the slat thickness, so the tops sit flush.
  The joints are modelled as real notches (segments), not as overlapping boxes.
- Six square legs under the rails.
- Headboard of horizontal boards with a strong grain, shelf on top, side panel on the right;
  it reaches past the bed on the right side.
Blender axes: x = across the bed, y = along the bed (head at +y), z = up. glTF: foot towards +Z.
"""
import bpy, bmesh, math, os, random
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- Masse (Meter) ------------------------------------------------------------
W, L = 1.50, 2.02                 # Lattenrost: Lattenlaenge (quer) x Laenge
N_SLATS, SLAT_W, SLAT_T = 21, 0.07, 0.04
TOP = 0.30                        # Oberkante Latten = Oberkante Traeger
RAIL_W, RAIL_H = 0.045, 0.08
RAILS_X = (-0.62, 0.0, 0.62)
LAP = SLAT_T / 2                  # Ueberblattung: beide Teile halb ausgeklinkt
LEG = 0.07
HB_X0, HB_X1 = -W / 2 - 0.02, W / 2 + 0.22     # Kopfteil, rechts ueberstehend
HB_Y = L / 2 + 0.03               # Vorderseite Kopfteil
BOARD_H, BOARD_GAP, N_BOARDS, BOARD_T = 0.15, 0.006, 6, 0.022
SHELF_D, SHELF_T = 0.20, 0.028

# --- Materialien ----------------------------------------------------------------
def mat(name, rgb, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m

def grain(name, dark, light, scale, axis, rough=0.55):
    """Maserung in Objektkoordinaten: Linien laufen entlang x, Baender wechseln entlang `axis` (Y bei den
    liegenden Latten, Z bei den stehenden Kopfteil-Brettern). Wird spaeter in eine Textur gebacken."""
    m = mat(name, dark, rough)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.08, 1.0, 1.0)
    wv = nt.nodes.new("ShaderNodeTexWave"); wv.wave_type = 'BANDS'; wv.bands_direction = axis
    wv.inputs["Scale"].default_value = scale; wv.inputs["Distortion"].default_value = 5.0
    wv.inputs["Detail"].default_value = 3.0; wv.inputs["Detail Scale"].default_value = 1.5
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*dark, 1); ramp.color_ramp.elements[1].color = (*light, 1)
    ramp.color_ramp.elements[0].position = 0.25; ramp.color_ramp.elements[1].position = 0.75
    L_ = nt.links.new
    L_(tc.outputs["Object"], mp.inputs["Vector"]); L_(mp.outputs["Vector"], wv.inputs["Vector"])
    L_(wv.outputs["Fac"], ramp.inputs["Fac"]); L_(ramp.outputs["Color"], b.inputs["Base Color"])
    return m

SLAT = grain("Latten_gebeizt", (0.035, 0.016, 0.007), (0.085, 0.045, 0.02), 18.0, 'Y')
RAIL = mat("Traeger_hell", (0.52, 0.36, 0.20), 0.65)          # ausgeklinkte, ungebeizte Flaechen
LEGM = mat("Fuesse_gebeizt", (0.05, 0.024, 0.011), 0.6)
HEAD = grain("Kopfteil_Fichte", (0.05, 0.024, 0.009), (0.26, 0.15, 0.065), 6.0, 'Z', 0.6)

# --- Geometrie --------------------------------------------------------------------
parts = {}
def box(matl, x0, x1, y0, y1, z0, z1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    bmesh.ops.translate(bm, verts=bm.verts, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    parts.setdefault(matl.name, (matl, bmesh.new()))
    me = bpy.data.meshes.new("tmp"); bm.to_mesh(me); bm.free()
    parts[matl.name][1].from_mesh(me); bpy.data.meshes.remove(me)

pitch = (L - SLAT_W) / (N_SLATS - 1)
slat_y = [-L / 2 + SLAT_W / 2 + i * pitch for i in range(N_SLATS)]

# Latten: volle Staerke zwischen den Traegern, ueber den Traegern nur die obere Haelfte
for y in slat_y:
    ys = (y - SLAT_W / 2, y + SLAT_W / 2)
    xs = [-W / 2]
    for rx in RAILS_X:
        xs += [rx - RAIL_W / 2, rx + RAIL_W / 2]
    xs.append(W / 2)
    for i in range(0, len(xs) - 1):
        top_only = i % 2 == 1                      # Abschnitt ueber einem Traeger
        box(SLAT, xs[i], xs[i + 1], *ys, TOP - (LAP if top_only else SLAT_T), TOP)

# Traeger: volle Hoehe zwischen den Latten, unter den Latten um LAP abgesenkt
for rx in RAILS_X:
    xs = (rx - RAIL_W / 2, rx + RAIL_W / 2)
    edges = [-L / 2]
    for y in slat_y:
        edges += [y - SLAT_W / 2, y + SLAT_W / 2]
    edges.append(L / 2)
    for i in range(len(edges) - 1):
        under = i % 2 == 1
        if edges[i + 1] - edges[i] < 1e-6:
            continue
        box(RAIL, *xs, edges[i], edges[i + 1], TOP - RAIL_H, TOP - (LAP if under else 0.0))

# Fuesse unter den Traegern, an Kopf- und Fussende eingerueckt
for rx in RAILS_X:
    for y in (-L / 2 + 0.18, L / 2 - 0.18):
        box(LEGM, rx - LEG / 2, rx + LEG / 2, y - LEG / 2, y + LEG / 2, 0.0, TOP - RAIL_H)

# Kopfteil: waagrechte Bretter, Ablage oben, Seitenwange rechts
z = 0.04
for i in range(N_BOARDS):
    box(HEAD, HB_X0, HB_X1, HB_Y, HB_Y + BOARD_T, z, z + BOARD_H)
    z += BOARD_H + BOARD_GAP
hb_top = z - BOARD_GAP
box(HEAD, HB_X0 - 0.01, HB_X1 + 0.01, HB_Y - 0.03, HB_Y - 0.03 + SHELF_D, hb_top, hb_top + SHELF_T)
box(HEAD, HB_X1 - BOARD_T, HB_X1, HB_Y + BOARD_T, HB_Y - 0.03 + SHELF_D, 0.04, hb_top)
box(HEAD, HB_X0, HB_X1 - BOARD_T, HB_Y - 0.03 + SHELF_D - BOARD_T, HB_Y - 0.03 + SHELF_D, 0.04, hb_top)

objs = []
for name, (matl, bm) in parts.items():
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(matl)
    ob = bpy.data.objects.new(f"Bett_{name}", me)
    scene.collection.objects.link(ob)
    bev = ob.modifiers.new("Fase", 'BEVEL'); bev.width = 0.002; bev.segments = 1; bev.limit_method = 'ANGLE'
    objs.append(ob)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "..", "bed.blend"))

# --- Export: Modifier anwenden, Maserung backen ----------------------------------
ctx = bpy.context
def select_only(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    ctx.view_layer.objects.active = obs[0]
select_only(objs)
bpy.ops.object.convert(target='MESH')
scene.render.engine = 'CYCLES'
scene.cycles.samples = 4
for ob in objs:
    m = ob.data.materials[0]
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if not b.inputs["Base Color"].links:
        continue
    select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(f"{m.name}_albedo", 1024, 1024)
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; nt.nodes.active = tex
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=4)
    img.pack()
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])

out = os.path.join(HERE, "..", "web", "bed-raw.glb")
tris = sum(len(p.vertices) - 2 for ob in objs for p in ob.data.polygons)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_image_format='JPEG')
print("WROTE", out, os.path.getsize(out) // 1024, "KB,", len(objs), "meshes,", tris, "tris")
