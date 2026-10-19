"""Werkbank mit Aufsatz (Lochwand, Regal) + Tischkreissaege daneben - procedurales Modell.
Ausfuehren: blender -b -P models/woodworking/source/build_workshop.py
Optional: WB_SAMPLES=32 fuer schnelle Vorschau, WB_NORENDER=1 um nur die .blend zu speichern.

Werkbank (angelehnt an Referenzbild):
- massives Nussbaum-Gestell, Arbeitsplatte 2,00 x 0,77 m, Hoehe 92 cm
- Schubladen in der Zarge, Schubladenschrank (5 Laden, helleres Holz), offene Faecher
- Aufsatz mit 4 Pfosten, Lochwand mit Werkzeug, Regalboden, Lattenrost oben,
  schwarze Stahlwinkel/-laschen
Tischkreissaege (Schrank-Bauweise) links neben der Werkbank, Tischhoehe ebenfalls 92 cm:
- Graugusstisch mit Verbreiterungen, Nuten fuer Gehrungsanschlag, Tischeinlage
- 254-mm-Saegeblatt mit HM-Zaehnen, Spaltkeil
- Parallelanschlag auf Fuehrungsschiene mit Massband, Gehrungsanschlag
- Handraeder (Hoehe/Neigung), Schalter, Absaugstutzen
Alle Masse in Metern."""
import bpy, bmesh, math, os, time
from mathutils import Vector, Matrix

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # models/woodworking
pi = math.pi
rad = math.radians

# --- Szene leeren -----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def new_col(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

COL_BENCH = new_col("Werkbank")
COL_DECO = new_col("Werkzeug_Deko")
COL_SAW = new_col("Tischkreissaege")
COL_ENV = new_col("Umgebung")
CUR = [COL_BENCH]

# --- Materialien ------------------------------------------------------------
def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1)
    return m

def ramp_mat(name, coord_chain, colors, rough=0.5, metal=0.0, constant=False):
    """Material, dessen Grundfarbe ueber eine ColorRamp aus einem Faktor kommt.
    coord_chain(nt) liefert den Ausgangs-Socket (Faktor)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    fac = coord_chain(nt)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    if constant:
        cr.interpolation = 'CONSTANT'
    cr.elements[0].position, cr.elements[0].color = colors[0][0], (*colors[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = colors[-1][0], (*colors[-1][1], 1)
    for pos, col in colors[1:-1]:
        e = cr.elements.new(pos); e.color = (*col, 1)
    nt.links.new(fac, ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    m.diffuse_color = (*colors[len(colors) // 2][1], 1)
    return m, nt, b, fac

def wood(name, dark, mid, light, axis, rough=0.5):
    """Holz mit Maserung in Richtung `axis` (Objektkoordinaten gestreckt)."""
    def chain(nt):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        s = [28.0, 28.0, 28.0]; s["XYZ".index(axis)] = 1.0
        mp.inputs["Scale"].default_value = s
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 3.0
        n.inputs["Detail"].default_value = 12.0
        n.inputs["Roughness"].default_value = 0.62
        n.inputs["Distortion"].default_value = 0.6
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        return n.outputs["Fac"]
    m, nt, b, fac = ramp_mat(name, chain, [(0.32, dark), (0.5, mid), (0.68, light)], rough)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    nt.links.new(fac, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m

WALNUT = [(0.05, 0.025, 0.012), (0.14, 0.07, 0.035), (0.26, 0.14, 0.065)]
LIGHT = [(0.22, 0.10, 0.04), (0.42, 0.22, 0.09), (0.58, 0.35, 0.16)]
W = {a: wood("Nussbaum_" + a, *WALNUT, a) for a in "XYZ"}
WL = {a: wood("Holz_hell_" + a, *LIGHT, a) for a in "XYZ"}

def pegboard_chain(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (40, 40, 40)          # Lochraster 25 mm
    fr = nt.nodes.new("ShaderNodeVectorMath"); fr.operation = 'FRACTION'
    sub = nt.nodes.new("ShaderNodeVectorMath"); sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    mul = nt.nodes.new("ShaderNodeVectorMath"); mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = (1, 0, 1)                 # Platte liegt in XZ
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = 'LENGTH'
    lt = nt.nodes.new("ShaderNodeMath"); lt.operation = 'LESS_THAN'
    lt.inputs[1].default_value = 0.17
    L = nt.links.new
    L(tc.outputs["Object"], mp.inputs["Vector"]); L(mp.outputs["Vector"], fr.inputs[0])
    L(fr.outputs["Vector"], sub.inputs[0]); L(sub.outputs["Vector"], mul.inputs[0])
    L(mul.outputs["Vector"], ln.inputs[0]); L(ln.outputs["Value"], lt.inputs[0])
    return lt.outputs["Value"]

PEG, _, _, _ = ramp_mat("Lochwand", pegboard_chain,
                        [(0.0, (0.30, 0.16, 0.07)), (0.5, (0.004, 0.003, 0.002))],
                        rough=0.7, constant=True)

def tape_chain(nt):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 100
    fr = nt.nodes.new("ShaderNodeMath"); fr.operation = 'FRACT'
    lt = nt.nodes.new("ShaderNodeMath"); lt.operation = 'LESS_THAN'; lt.inputs[1].default_value = 0.12
    L = nt.links.new
    L(tc.outputs["Object"], sep.inputs[0]); L(sep.outputs["X"], mul.inputs[0])
    L(mul.outputs["Value"], fr.inputs[0]); L(fr.outputs["Value"], lt.inputs[0])
    return lt.outputs["Value"]

TAPE, _, _, _ = ramp_mat("Massband", tape_chain,
                         [(0.0, (0.9, 0.7, 0.02)), (0.5, (0.01, 0.01, 0.01))], rough=0.4, constant=True)

def noise_chain(scale, detail=6.0):
    def chain(nt):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        return n.outputs["Fac"]
    return chain

CONCRETE_WALL, _, _, _ = ramp_mat("Beton_Wand", noise_chain(6.0, 10),
                                  [(0.35, (0.28, 0.29, 0.30)), (0.65, (0.45, 0.46, 0.47))], rough=0.9)
CONCRETE_FLOOR, _, _, _ = ramp_mat("Beton_Boden", noise_chain(3.0, 12),
                                   [(0.3, (0.22, 0.22, 0.21)), (0.7, (0.42, 0.41, 0.39))], rough=0.75)
CAST_IRON, _, _, _ = ramp_mat("Grauguss", noise_chain(40.0, 8),
                              [(0.35, (0.30, 0.31, 0.32)), (0.65, (0.45, 0.46, 0.47))], rough=0.32, metal=0.9)

BLACK_STEEL = mat("Stahl_schwarz", (0.02, 0.02, 0.02), 0.45, 0.6)
STEEL = mat("Stahl_blank", (0.7, 0.7, 0.72), 0.22, 1.0)
BLADE_STEEL = mat("Saegeblatt", (0.75, 0.76, 0.78), 0.15, 1.0)
CARBIDE = mat("Hartmetall", (0.25, 0.25, 0.26), 0.35, 1.0)
ALU = mat("Aluminium", (0.78, 0.79, 0.8), 0.3, 1.0)
PAINT = mat("Lack_Anthrazit", (0.045, 0.05, 0.055), 0.35, 0.2)
BLACK_PLASTIC = mat("Kunststoff_schwarz", (0.012, 0.012, 0.012), 0.5)
YELLOW = mat("Kunststoff_gelb", (0.95, 0.65, 0.02), 0.4)
RED = mat("Kunststoff_rot", (0.6, 0.02, 0.02), 0.4)
GREEN = mat("Kunststoff_gruen", (0.02, 0.4, 0.05), 0.4)
BLUE = mat("Kunststoff_blau", (0.03, 0.12, 0.45), 0.4)
RUBBER = mat("Gummi", (0.02, 0.02, 0.02), 0.9)
CARDBOARD = mat("Karton", (0.55, 0.40, 0.25), 0.85)
BRASS = mat("Messing", (0.75, 0.55, 0.25), 0.3, 1.0)
GLASS_DARK = mat("Glas_dunkel", (0.06, 0.04, 0.02), 0.1)
PAPER = mat("Papier", (0.9, 0.9, 0.88), 0.8)
INSERT = mat("Tischeinlage", (0.55, 0.05, 0.03), 0.45)

# --- Geometrie-Helfer -------------------------------------------------------
def link(ob, col=None):
    (col or CUR[0]).objects.link(ob)
    return ob

def mesh_obj(name, bm, m, col=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(m)
    return link(ob, col)

def bevel(ob, w=0.002, seg=2):
    mod = ob.modifiers.new("Bevel", 'BEVEL')
    mod.width = w; mod.segments = seg; mod.limit_method = 'ANGLE'
    return ob

def smooth_bm(bm, ang=40):
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0) > rad(ang):
            e.smooth = False

def blk(name, xs, ys, zs, m, bev=0.002, col=None):
    """Quader aus Min/Max-Koordinaten."""
    (x0, x1), (y0, y1), (z0, z1) = xs, ys, zs
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    ob = mesh_obj(name, bm, m, col)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return bevel(ob, bev) if bev else ob

def cbox(name, size, loc, m, rot=(0, 0, 0), bev=0.0015, col=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((*size, 1)))
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc; ob.rotation_euler = rot
    return bevel(ob, bev) if bev else ob

def cyl(name, r, depth, loc, m, rot=(0, 0, 0), seg=32, r2=None, col=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    smooth_bm(bm)
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc; ob.rotation_euler = rot
    return ob

def sphere(name, r, loc, m, col=None, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r)
    for f in bm.faces:
        f.smooth = True
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc; ob.scale = scale
    return ob

def torus(name, R, r, m, loc=(0, 0, 0), rot=(0, 0, 0), M=48, n=12, col=None):
    """Torus in der lokalen XY-Ebene."""
    bm = bmesh.new()
    rings = []
    for i in range(M):
        a = 2 * pi * i / M
        ring = []
        for j in range(n):
            b = 2 * pi * j / n
            rr = R + r * math.cos(b)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    for i in range(M):
        for j in range(n):
            a, b = rings[i], rings[(i + 1) % M]
            bm.faces.new((a[j], b[j], b[(j + 1) % n], a[(j + 1) % n]))
    for f in bm.faces:
        f.smooth = True
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc; ob.rotation_euler = rot
    return ob

def profile_obj(name, pts, thick, m, col=None):
    """Flaches Teil aus 2D-Profil (y, z), in X um `thick` extrudiert (zentriert)."""
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((-thick / 2, y, z)) for y, z in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    vs = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=vs, vec=(thick, 0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, m, col)

def empty(name, loc, rot=(0, 0, 0), col=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc; e.rotation_euler = rot
    e.empty_display_size = 0.05
    return link(e, col)

def parent(children, p):
    for c in children:
        c.parent = p

def apply_booleans(target, cutters):
    for c in cutters:
        mod = target.modifiers.new("Cut", 'BOOLEAN')
        mod.operation = 'DIFFERENCE'; mod.object = c
    with bpy.context.temp_override(object=target, active_object=target, selected_objects=[target]):
        for mod in list(target.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)

def handle(cx, cz, yf, length, col=None):
    """Schwarzer Buegelgriff vor einer Front bei y = yf."""
    cyl("Griff", 0.006, length, (cx, yf - 0.028, cz), BLACK_STEEL, rot=(0, pi / 2, 0), seg=16, col=col)
    for s in (-1, 1):
        cyl("Griff_Fuss", 0.0045, 0.03, (cx + s * (length / 2 - 0.012), yf - 0.014, cz),
            BLACK_STEEL, rot=(pi / 2, 0, 0), seg=12, col=col)

def screws_plate(name, xs, zs, yf):
    """Schwarze Stahllasche mit 4 Schraubenkoepfen auf einer Front (y = yf)."""
    blk(name, xs, (yf - 0.004, yf), zs, BLACK_STEEL, bev=0.0008)
    for x in (xs[0] + 0.015, xs[1] - 0.015):
        for z in (zs[0] + 0.015, zs[1] - 0.015):
            cyl("Schraube", 0.0045, 0.003, (x, yf - 0.005, z), STEEL, rot=(pi / 2, 0, 0), seg=12)

# ===========================================================================
# WERKBANK
# ===========================================================================
TOP = 0.92            # Oberkante Arbeitsplatte
TT = 0.06             # Plattenstaerke
LXS = [(-0.98, -0.90), (0.90, 0.98)]     # Beine/Pfosten in X
LYF, LYB = (-0.34, -0.26), (0.28, 0.36)  # Beine vorne/hinten in Y
CAB = [(0.18, 0.25), (0.62, 0.69)]       # Pfosten Schubladenschrank
APRON = (0.74, TOP - TT)

for xs in LXS:
    for ys in (LYF, LYB):
        blk("Bein", xs, ys, (0, TOP - TT), W["Z"], 0.003)
for xs in CAB:
    for ys in (LYF, LYB):
        blk("Schrankpfosten", xs, ys, (0.0, APRON[0]), W["Z"], 0.003)

# Zargen
blk("Zarge_vorne", (-0.90, 0.90), (-0.33, -0.30), APRON, W["X"])
blk("Zarge_hinten", (-0.90, 0.90), (0.30, 0.33), APRON, W["X"])
for xs in LXS:
    blk("Zarge_Seite", xs, (-0.26, 0.28), APRON, W["Y"])
    blk("Riegel_Seite_unten", xs, (-0.26, 0.28), (0.05, 0.13), W["Y"])
blk("Riegel_vorne_unten", (-0.90, 0.90), (-0.335, -0.30), (0.05, 0.13), W["X"], 0.003)
blk("Riegel_hinten_unten", (-0.90, 0.90), (0.30, 0.36), (0.05, 0.13), W["X"], 0.003)

# Arbeitsplatte + Aufkantung
blk("Arbeitsplatte", (-1.0, 1.0), (-0.39, 0.38), (TOP - TT, TOP), W["X"], 0.004)
blk("Aufkantung", (-0.90, 0.90), (0.345, 0.372), (TOP, TOP + 0.11), W["X"], 0.003)

# Schubladen in der Zarge
for x0, x1 in [(-0.895, -0.355), (-0.345, 0.175), (0.255, 0.615), (0.695, 0.895)]:
    blk("Zargenschublade", (x0, x1), (-0.352, -0.33), (APRON[0] + 0.008, APRON[1] - 0.008), WL["X"])
    handle((x0 + x1) / 2, (APRON[0] + APRON[1]) / 2, -0.352, 0.12 if x1 - x0 > 0.3 else 0.09)

# Schubladenschrank
blk("Schrank_Korpus", (0.25, 0.62), (-0.32, 0.33), (0.13, APRON[0]), WL["X"], 0.001)
n_dr, z0, z1 = 5, 0.135, APRON[0] - 0.005
h = (z1 - z0) / n_dr
for i in range(n_dr):
    a, b = z0 + i * h + 0.003, z0 + (i + 1) * h - 0.003
    blk("Schrankschublade", (0.256, 0.614), (-0.338, -0.318), (a, b), WL["X"])
    handle(0.435, (a + b) / 2 + h * 0.18, -0.338, 0.08)

# Boeden + Rueckwand
blk("Boden_unten", (-0.90, 0.90), (-0.30, 0.33), (0.105, 0.13), W["X"])
for xs in [(-0.90, 0.18), (0.69, 0.90)]:
    blk("Zwischenboden", xs, (-0.30, 0.33), (0.42, 0.445), W["X"])
    blk("Zwischenboden_Kante", xs, (-0.335, -0.30), (0.40, 0.445), W["X"])
blk("Rueckwand", (-0.90, 0.90), (0.33, 0.345), (0.13, APRON[0]), W["X"], 0.001)

# --- Aufsatz ---------------------------------------------------------------
HY_F, HY_B = (0.0, 0.07), (0.30, 0.37)
HZ_TOP = 2.08
SHELF_Z = (1.55, 1.58)
for xs in LXS:
    for ys in (HY_F, HY_B):
        blk("Aufsatzpfosten", xs, ys, (TOP, HZ_TOP), W["Z"], 0.003)
    for zs in [(1.06, 1.11), (SHELF_Z[0] - 0.05, SHELF_Z[0]), (HZ_TOP - 0.08, HZ_TOP)]:
        blk("Aufsatz_Seitenriegel", xs, (0.07, 0.30), zs, W["Y"])
blk("Aufsatz_Rahmen_vorne", (-0.98, 0.98), HY_F, (HZ_TOP - 0.08, HZ_TOP), W["X"], 0.003)
blk("Aufsatz_Rahmen_hinten", (-0.98, 0.98), HY_B, (HZ_TOP - 0.08, HZ_TOP), W["X"], 0.003)
for i in range(9):
    x = -0.80 + i * 0.20
    blk("Latte", (x - 0.03, x + 0.03), (0.07, 0.30), (HZ_TOP - 0.035, HZ_TOP - 0.005), W["Y"])
cbox("Brett_lose", (0.62, 0.24, 0.022), (-0.35, 0.19, HZ_TOP + 0.011), W["X"], rot=(0, 0, rad(-1.5)), bev=0.002)
# Stahlwinkel vorne am Rahmen
blk("Stahlwinkel_oben", (-0.985, 0.985), (-0.006, 0.07), (HZ_TOP, HZ_TOP + 0.004), BLACK_STEEL, 0.0008)
blk("Stahlwinkel_vorne", (-0.985, 0.985), (-0.006, 0.0), (HZ_TOP - 0.04, HZ_TOP + 0.004), BLACK_STEEL, 0.0008)

# Regalboden
blk("Regalboden", (-0.98, 0.98), (-0.01, 0.37), SHELF_Z, W["X"], 0.003)
blk("Regalboden_Kante_Stahl", (-0.98, 0.98), (-0.015, -0.01), (SHELF_Z[0] - 0.015, SHELF_Z[1]), BLACK_STEEL, 0.0008)

# Lochwand mit Rahmenleisten
blk("Lochwand", (-0.90, 0.90), (0.352, 0.364), (1.10, 1.50), PEG, 0.0)
blk("Lochwand_Leiste_unten", (-0.90, 0.90), (0.34, 0.37), (1.07, 1.10), W["X"])
blk("Lochwand_Leiste_oben", (-0.90, 0.90), (0.34, 0.37), (1.50, SHELF_Z[0]), W["X"])

# Stahllaschen an den vorderen Pfosten
for xs in LXS:
    for zs in [(TOP + 0.01, TOP + 0.13), (SHELF_Z[0] - 0.06, SHELF_Z[1] + 0.04), (HZ_TOP - 0.12, HZ_TOP - 0.01)]:
        screws_plate("Stahllasche", (xs[0] - 0.004, xs[1] + 0.004), zs, HY_F[0])
    screws_plate("Stahllasche_Fuss", (xs[0] - 0.004, xs[1] + 0.004), (0.02, 0.13), LYF[0])

# Kleines Regal auf der Lochwand
CUR[0] = COL_BENCH
SR_X, SR_Y, SR_Z = (0.38, 0.86), (0.22, 0.352), (1.13, 1.46)
for x in (SR_X[0], SR_X[1] - 0.018):
    blk("Wandregal_Seite", (x, x + 0.018), SR_Y, SR_Z, W["Z"])
for z in (SR_Z[0], 1.29, SR_Z[1] - 0.018):
    blk("Wandregal_Boden", (SR_X[0] + 0.018, SR_X[1] - 0.018), SR_Y, (z, z + 0.018), W["X"])

# ===========================================================================
# DEKO / WERKZEUG
# ===========================================================================
CUR[0] = COL_DECO
PEG_Y = 0.352

def hook(x, z, length=0.05):
    cyl("Lochwandhaken", 0.0025, length, (x, PEG_Y - length / 2, z), BLACK_STEEL, rot=(pi / 2, 0, 0), seg=8)

# Hammer
hook(-0.78, 1.43); hook(-0.72, 1.43)
cyl("Hammer_Stiel", 0.013, 0.28, (-0.75, PEG_Y - 0.035, 1.30), WL["Z"], seg=16)
cbox("Hammer_Kopf", (0.12, 0.028, 0.03), (-0.75, PEG_Y - 0.035, 1.455), BLACK_STEEL, bev=0.003)
# Schraubendreherhalter
blk("Schraubendreherhalter", (-0.52, -0.18), (0.30, PEG_Y), (1.235, 1.247), BLACK_STEEL, 0.001)
for x, m in zip((-0.48, -0.415, -0.35, -0.285, -0.22), (RED, BLUE, BLUE, BLACK_PLASTIC, YELLOW)):
    cyl("Schraubendreher_Griff", 0.012, 0.10, (x, 0.325, 1.30), m, seg=16)
    cyl("Schraubendreher_Klinge", 0.003, 0.13, (x, 0.325, 1.185), STEEL, seg=8)
# Zange
hook(-0.05, 1.42)
for s in (-1, 1):
    cbox("Zange_Schenkel", (0.012, 0.008, 0.17), (-0.05 + s * 0.018, PEG_Y - 0.03, 1.27),
         BLACK_PLASTIC, rot=(0, rad(s * 7), 0), bev=0.003)
cbox("Zange_Kopf", (0.03, 0.012, 0.06), (-0.05, PEG_Y - 0.03, 1.385), BLACK_STEEL, bev=0.003)
# Schraubenschluessel
hook(0.13, 1.43); hook(0.22, 1.43)
for x, ln in ((0.13, 0.20), (0.22, 0.24)):
    cbox("Schluessel", (0.02, 0.006, ln), (x, PEG_Y - 0.03, 1.415 - ln / 2), STEEL, bev=0.002)
    torus("Schluessel_Ring", 0.016, 0.005, STEEL, (x, PEG_Y - 0.03, 1.425), rot=(pi / 2, 0, 0), M=24, n=8)
# Wasserwaage
hook(-0.75, 1.10); hook(-0.35, 1.10)
cbox("Wasserwaage", (0.60, 0.025, 0.05), (-0.55, PEG_Y - 0.04, 1.13), YELLOW, bev=0.003)
cyl("Libelle", 0.006, 0.05, (-0.55, PEG_Y - 0.0535, 1.13), GREEN, rot=(0, pi / 2, 0), seg=12)

# Glaeser im kleinen Regal
for row_z in (SR_Z[0] + 0.018, 1.29 + 0.018):
    for i in range(10):
        x = SR_X[0] + 0.045 + i * 0.044
        if x > SR_X[1] - 0.03:
            break
        hgt = 0.055 if (i + int(row_z * 10)) % 3 else 0.07
        cyl("Glas", 0.017, hgt, (x, 0.29, row_z + hgt / 2), GLASS_DARK, seg=20)
        cyl("Deckel", 0.018, 0.012, (x, 0.29, row_z + hgt + 0.006), (BRASS, YELLOW, BLACK_PLASTIC)[i % 3], seg=20)

# Kartons + Dosen auf dem Regalboden
sz = SHELF_Z[1]
for x0, x1, hgt in [(-0.90, -0.66, 0.19), (-0.64, -0.44, 0.16), (-0.42, -0.24, 0.13), (-0.22, -0.04, 0.13)]:
    blk("Karton", (x0, x1), (0.06, 0.32), (sz, sz + hgt), CARDBOARD, 0.003)
cbox("Karton_klein", (0.12, 0.08, 0.05), (-0.79, 0.18, sz + 0.215), CARDBOARD, rot=(0, 0, rad(8)), bev=0.002)
for i, (r, hgt, m) in enumerate([(0.03, 0.10, GLASS_DARK), (0.025, 0.12, BRASS), (0.032, 0.09, GLASS_DARK),
                                 (0.022, 0.13, BLACK_PLASTIC), (0.03, 0.10, BRASS), (0.026, 0.08, GLASS_DARK),
                                 (0.03, 0.11, GLASS_DARK)]):
    x = 0.08 + i * 0.085
    cyl("Dose", r, hgt, (x, 0.20, sz + hgt / 2), m, seg=24)
cyl("Messingtopf", 0.05, 0.09, (0.80, 0.18, sz + 0.045), BRASS, seg=32, r2=0.055)

# Arbeitsplatte
cbox("Zeichnung", (0.30, 0.21, 0.0006), (-0.45, -0.18, TOP + 0.0003), PAPER, rot=(0, 0, rad(4)), bev=0)
cyl("Bleistift", 0.004, 0.17, (-0.62, -0.10, TOP + 0.004), YELLOW, rot=(0, pi / 2, rad(20)), seg=6)
cyl("Holzhammer_Stiel", 0.012, 0.26, (0.45, -0.05, TOP + 0.03), WL["X"], rot=(0, pi / 2, rad(-25)), seg=16)
cbox("Holzhammer_Kopf", (0.07, 0.13, 0.06), (0.57, -0.11, TOP + 0.03), WL["Y"], rot=(0, 0, rad(-25)), bev=0.004)

# Unten: Werkzeugkoffer, Koffer, Kasten
blk("Werkzeugkoffer", (-0.82, -0.40), (-0.22, 0.15), (0.13, 0.31), BLACK_PLASTIC, 0.01)
blk("Werkzeugkoffer_Deckelfuge", (-0.823, -0.397), (-0.223, 0.153), (0.255, 0.262), RUBBER, 0.001)
blk("Werkzeugkoffer_Griff", (-0.70, -0.52), (-0.04, -0.01), (0.31, 0.34), BLACK_PLASTIC, 0.008)
for x in (-0.76, -0.46):
    blk("Verschluss", (x - 0.02, x + 0.02), (-0.228, -0.22), (0.24, 0.28), STEEL, 0.001)
blk("Kleinteilekasten", (-0.30, 0.05), (-0.20, 0.15), (0.13, 0.20), W["X"], 0.003)
blk("Maschinenkoffer", (-0.62, -0.30), (-0.18, 0.20), (0.445, 0.61), BLACK_PLASTIC, 0.012)
for i in range(3):
    cyl("Klebeband", 0.05, 0.05, (-0.80, 0.05, 0.47 + i * 0.05), (YELLOW, BLACK_PLASTIC, YELLOW)[i], seg=32)
blk("Kiste_rechts", (0.71, 0.88), (-0.18, 0.18), (0.445, 0.56), CARDBOARD, 0.003)

# ===========================================================================
# TISCHKREISSAEGE
# ===========================================================================
CUR[0] = COL_SAW
SX = -2.05                # Mitte Saege (links neben der Werkbank)
BX = SX - 0.03            # Ebene des Saegeblatts
TY0, TY1 = -0.38, 0.30    # Tisch vorne/hinten
R_BLADE = 0.127
BY, BZ = 0.0, TOP + 0.065 - R_BLADE   # Blatt ragt 65 mm ueber den Tisch
MS = [BX - 0.16, BX + 0.14]           # Nuten fuer Gehrungsanschlag

# Unterbau
for x in (SX - 0.25, SX + 0.25):
    for y in (-0.31, 0.25):
        cyl("Gummifuss", 0.022, 0.015, (x, y, 0.0075), RUBBER, seg=16)
blk("Sockel", (SX - 0.29, SX + 0.29), (-0.33, 0.27), (0.015, 0.07), BLACK_PLASTIC, 0.004)
blk("Schrank", (SX - 0.26, SX + 0.26), (-0.30, 0.24), (0.07, 0.85), PAINT, 0.008)
blk("Schrank_Flansch", (SX - 0.27, SX + 0.27), (-0.31, 0.25), (0.85, 0.868), PAINT, 0.003)
blk("Typenschild", (SX + 0.06, SX + 0.22), (-0.302, -0.30), (0.78, 0.82), ALU, 0.001)
blk("Typenschild_Streifen", (SX + 0.06, SX + 0.22), (-0.3025, -0.302), (0.786, 0.792), RED, 0)
# Motorabdeckung mit Lueftungsschlitzen (links)
blk("Motorabdeckung", (SX - 0.30, SX - 0.26), (-0.16, 0.13), (0.30, 0.66), PAINT, 0.012)
for i in range(7):
    z = 0.40 + i * 0.025
    blk("Lueftungsschlitz", (SX - 0.3005, SX - 0.296), (-0.10, 0.07), (z, z + 0.008), BLACK_PLASTIC, 0)
cyl("Absaugstutzen", 0.05, 0.10, (SX, 0.28, 0.22), BLACK_PLASTIC, rot=(pi / 2, 0, 0), seg=32)
cyl("Absaugstutzen_Ring", 0.056, 0.015, (SX, 0.32, 0.22), BLACK_PLASTIC, rot=(pi / 2, 0, 0), seg=32)

# Tisch (Grauguss) mit Nuten und Ausnehmung fuer die Einlage
table = blk("Tisch", (SX - 0.35, SX + 0.35), (TY0, TY1), (0.87, TOP), CAST_IRON, 0)
cutters = [blk("cut", (x - 0.0095, x + 0.0095), (TY0 - 0.01, TY1 + 0.01), (TOP - 0.009, TOP + 0.01), STEEL, 0)
           for x in MS]
cutters.append(blk("cut", (BX - 0.045, BX + 0.045), (-0.17, 0.17), (TOP - 0.012, TOP + 0.01), STEEL, 0))
apply_booleans(table, cutters)
bevel(table, 0.0015, 2)
for xs in [(SX - 0.62, SX - 0.351), (SX + 0.351, SX + 0.62)]:
    wing = blk("Tischverbreiterung", xs, (TY0, TY1), (0.875, TOP), CAST_IRON, 0.0015)
# Tischeinlage (zwei Haelften um den Saegeschlitz), Schlitz dunkel
for xs in [(BX - 0.0445, BX - 0.004), (BX + 0.004, BX + 0.0445)]:
    blk("Tischeinlage", xs, (-0.1695, 0.1695), (TOP - 0.012, TOP - 0.0004), INSERT, 0.001)
blk("Schlitz_unten", (BX - 0.004, BX + 0.004), (-0.17, 0.17), (TOP - 0.03, TOP - 0.02), BLACK_PLASTIC, 0)
for y in (-0.15, 0.15):
    cyl("Einlage_Schraube", 0.004, 0.002, (BX - 0.03, y, TOP - 0.0005), BLACK_STEEL, seg=12)

# Saegeblatt mit Hartmetallzaehnen (dreht so, dass die Zaehne oben zum Bediener laufen)
N_TEETH, GULLET = 48, 0.009
step = 2 * pi / N_TEETH
pts = []
for i in range(N_TEETH):
    a = i * step
    for rr, aa in ((R_BLADE, a), (R_BLADE - GULLET, a + 0.22 * step), (R_BLADE - GULLET * 0.45, a + 0.55 * step)):
        pts.append((rr * math.cos(aa), rr * math.sin(aa)))
blade = profile_obj("Saegeblatt", pts, 0.0022, BLADE_STEEL)
blade.location = (BX, BY, BZ)
bm = bmesh.new()
for i in range(N_TEETH):
    a = i * step
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Rotation(a, 4, 'X')
                          @ Matrix.Translation((0, R_BLADE - 0.0025, 0.0012))
                          @ Matrix.Diagonal((0.0032, 0.005, 0.0026, 1)))
tips = mesh_obj("Hartmetallzaehne", bm, CARBIDE)
tips.location = (BX, BY, BZ)
cyl("Spannflansch", 0.04, 0.008, (BX + 0.005, BY, BZ), STEEL, rot=(0, pi / 2, 0), seg=32)
cyl("Spannmutter", 0.016, 0.012, (BX + 0.013, BY, BZ), STEEL, rot=(0, pi / 2, 0), seg=6)

# Spaltkeil hinter dem Blatt
arc = lambda r, a: (r * math.cos(rad(a)), r * math.sin(rad(a)))
knife_pts = [arc(R_BLADE + 0.045, a) for a in range(24, 84, 6)] + \
            [arc(R_BLADE + 0.006, a) for a in range(82, 22, -6)]
knife = profile_obj("Spaltkeil", knife_pts, 0.0025, BLACK_STEEL)
knife.location = (BX, BY, BZ)

# Fuehrungsschienen
RX = (SX - 0.70, SX + 0.85)
blk("Fuehrungsrohr_vorne", RX, (TY0 - 0.075, TY0 - 0.025), (0.815, 0.885), ALU, 0.003)
blk("Fuehrungswinkel", RX, (TY0 - 0.08, TY0 - 0.02), (0.885, 0.891), BLACK_STEEL, 0.0008)
blk("Massband", (SX - 0.30, SX + 0.85), (TY0 - 0.065, TY0 - 0.035), (0.891, 0.8915), TAPE, 0)
cyl("Fuehrungsrohr_hinten", 0.022, RX[1] - RX[0], ((RX[0] + RX[1]) / 2, TY1 + 0.035, 0.87), ALU,
    rot=(0, pi / 2, 0), seg=24)
for x in (SX - 0.55, SX - 0.15, SX + 0.25, SX + 0.55):
    blk("Schienenhalter_vorne", (x - 0.02, x + 0.02), (TY0 - 0.025, TY0 + 0.01), (0.835, 0.875), BLACK_STEEL, 0.001)
    blk("Schienenhalter_hinten", (x - 0.02, x + 0.02), (TY1 - 0.01, TY1 + 0.02), (0.855, 0.885), BLACK_STEEL, 0.001)

# Parallelanschlag
FX = BX + 0.28
blk("Anschlag_Profil", (FX, FX + 0.055), (TY0 - 0.02, TY1), (TOP + 0.0005, TOP + 0.075), ALU, 0.003)
blk("Anschlag_Endkappe", (FX, FX + 0.055), (TY1, TY1 + 0.012), (TOP + 0.0005, TOP + 0.075), BLACK_PLASTIC, 0.003)
blk("Anschlag_Kopf", (FX - 0.02, FX + 0.075), (TY0 - 0.095, TY0 - 0.02), (0.80, TOP + 0.08), BLACK_PLASTIC, 0.006)
blk("Anschlag_Lupe", (FX - 0.03, FX - 0.02), (TY0 - 0.07, TY0 - 0.03), (0.885, 0.905), ALU, 0.001)
lever = cyl("Anschlag_Hebel", 0.007, 0.14, (FX + 0.0275, TY0 - 0.125, TOP + 0.08), BLACK_STEEL,
            rot=(rad(55), 0, 0), seg=12)
sphere("Anschlag_Knauf", 0.016, (FX + 0.0275, TY0 - 0.18, TOP + 0.12), RED)

# Gehrungsanschlag in der linken Nut
mx = MS[0]
blk("Gehrung_Schiene", (mx - 0.009, mx + 0.009), (-0.33, 0.14), (TOP - 0.0088, TOP - 0.0005), STEEL, 0.0005)
hb = bmesh.new()
segs = 24
v = [hb.verts.new((0, 0, 0))] + [hb.verts.new((0.075 * math.cos(pi + pi * k / segs), 0.075 * math.sin(pi + pi * k / segs), 0))
                                  for k in range(segs + 1)]
f = hb.faces.new(v)
ext = bmesh.ops.extrude_face_region(hb, geom=[f])
bmesh.ops.translate(hb, verts=[g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)], vec=(0, 0, 0.012))
bmesh.ops.recalc_face_normals(hb, faces=hb.faces)
gh = mesh_obj("Gehrung_Kopf", hb, ALU)
gh.location = (mx, -0.30, TOP + 0.0005)
blk("Gehrung_Anschlag", (mx - 0.13, mx + 0.11), (-0.30, -0.278), (TOP + 0.0005, TOP + 0.05), ALU, 0.002)
cyl("Gehrung_Griff", 0.012, 0.09, (mx, -0.35, TOP + 0.055), BLACK_PLASTIC, seg=16, r2=0.009)
sphere("Gehrung_Griffknauf", 0.018, (mx, -0.35, TOP + 0.105), BLACK_PLASTIC)

# Handraeder
def handwheel(name, loc, rot):
    e = empty(name, loc, rot)
    parts = [torus(name + "_Kranz", 0.075, 0.008, BLACK_STEEL, (0, 0, 0.045), M=48, n=10),
             cyl(name + "_Nabe", 0.02, 0.05, (0, 0, 0.025), STEEL, seg=24),
             cyl(name + "_Klemmknauf", 0.014, 0.03, (0, 0, 0.065), BLACK_PLASTIC, seg=16),
             cyl(name + "_Kurbel", 0.009, 0.06, (0.075, 0, 0.08), BLACK_PLASTIC, seg=16, r2=0.007)]
    for k in range(3):
        a = 2 * pi * k / 3 + pi / 2
        parts.append(cbox(name + "_Speiche", (0.06, 0.012, 0.007),
                          (0.047 * math.cos(a), 0.047 * math.sin(a), 0.045), BLACK_STEEL, rot=(0, 0, a), bev=0.002))
    parent(parts, e)
    return e

# Bogenfuehrung (Neigung) auf der Front
ARC_C = (SX, 0.48)
bm = bmesh.new()
ring_in, ring_out = [], []
for k in range(25):
    a = rad(40 + 100 * k / 24)
    ring_in.append(bm.verts.new((0.165 * math.cos(a), 0, 0.165 * math.sin(a))))
    ring_out.append(bm.verts.new((0.19 * math.cos(a), 0, 0.19 * math.sin(a))))
for k in range(24):
    bm.faces.new((ring_in[k], ring_in[k + 1], ring_out[k + 1], ring_out[k]))
slot = mesh_obj("Bogenschlitz", bm, BLACK_PLASTIC)
slot.location = (ARC_C[0], -0.3015, ARC_C[1])
a = rad(100)
handwheel("Handrad_Hoehe", (SX + 0.1775 * math.cos(a), -0.30, ARC_C[1] + 0.1775 * math.sin(a)), (pi / 2, 0, 0))
handwheel("Handrad_Neigung", (SX + 0.26, -0.05, 0.55), (0, pi / 2, 0))
blk("Neigungsskala", (SX - 0.12, SX + 0.12), (-0.303, -0.30), (0.70, 0.72), TAPE, 0)

# Schalter unter der Fuehrungsschiene
SWX = SX - 0.47
blk("Schaltergehaeuse", (SWX - 0.06, SWX + 0.06), (TY0 - 0.09, TY0 - 0.04), (0.71, 0.815), YELLOW, 0.006)
cyl("Taster_Ein", 0.012, 0.012, (SWX, TY0 - 0.095, 0.785), GREEN, rot=(pi / 2, 0, 0), seg=20)
blk("Taster_Aus", (SWX - 0.045, SWX + 0.045), (TY0 - 0.105, TY0 - 0.088), (0.718, 0.765), RED, 0.004)

# ===========================================================================
# UMGEBUNG, LICHT, KAMERA
# ===========================================================================
CUR[0] = COL_ENV
blk("Boden", (-5, 5), (-6, 1.0), (-0.02, 0.0), CONCRETE_FLOOR, 0)
blk("Wand", (-5, 5), (0.47, 0.52), (0.0, 3.2), CONCRETE_WALL, 0)
blk("Wand_links", (-3.35, -3.30), (-3.0, 0.52), (0.0, 3.2), CONCRETE_WALL, 0)

def area(name, loc, rot, size, energy, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc; o.rotation_euler = rot
    return link(o)

area("Deckenlicht", (-0.9, -1.2, 3.0), (0, 0, 0), 3.0, 220, (1.0, 0.95, 0.88))
area("Fuehrungslicht", (-2.6, -3.2, 2.0), (rad(65), 0, rad(-25)), 2.0, 110)
area("Fuelllicht", (2.2, -2.4, 1.6), (rad(70), 0, rad(55)), 1.5, 60, (0.85, 0.9, 1.0))

world = bpy.data.worlds.new("Welt"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.52, 0.55, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12

def camera(name, loc, target, lens):
    t = empty(name + "_Ziel", target)
    cd = bpy.data.cameras.new(name); cd.lens = lens
    c = bpy.data.objects.new(name, cd); c.location = loc
    link(c)
    tc = c.constraints.new('TRACK_TO'); tc.target = t
    return c

cam_34 = camera("Kamera_Schraeg", (-2.9, -3.7, 1.75), (-0.9, 0.0, 0.95), 30)
cam_front = camera("Kamera_Front", (-0.85, -4.9, 1.45), (-0.85, 0.0, 1.0), 33)
scene.camera = cam_34

# --- Render / Speichern -----------------------------------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = int(os.environ.get("WB_SAMPLES", 96))
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
looks = [i.identifier for i in scene.view_settings.bl_rna.properties['look'].enum_items]
scene.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in looks else 'None'

try:  # GPU nutzen, falls vorhanden
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dev_type in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = dev_type
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == dev_type]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == dev_type
            scene.cycles.device = 'GPU'
            print("Render-Geraet:", dev_type, [d.name for d in gpus])
            break
except Exception as ex:
    print("GPU-Setup uebersprungen:", ex)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "workshop.blend"))
if not os.environ.get("WB_NORENDER"):
    for cam, suffix in ((cam_34, "schraeg"), (cam_front, "front")):
        scene.camera = cam
        final = os.path.join(OUT_DIR, "review", f"render_{suffix}.png")
        scene.render.filepath = final[:-4] + "_tmp.png"   # Ziel kann von einer Vorschau gesperrt sein
        bpy.ops.render.render(write_still=True)
        for _ in range(20):
            try:
                os.replace(scene.render.filepath, final); break
            except PermissionError:
                time.sleep(0.5)
    scene.camera = cam_34
print("FERTIG")
