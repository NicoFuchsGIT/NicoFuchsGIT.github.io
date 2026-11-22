"""Formula-Student-Elektrorennwagen, frei angelehnt an die EDGE-Fahrzeuge von TU Wien Racing
- procedurales Modell, nur bpy/bmesh.
Ausfuehren: blender -b -P models/formula-student/source/build_formula_student.py
Optional: WB_SAMPLES=32 fuer schnelle Vorschau, WB_NORENDER=1 um nur die .blend zu speichern.

Fahrzeug (x = Fahrtrichtung, y = links/rechts, z = oben, Boden bei z = 0):
- Carbon-Monocoque als Loft aus Superellipsen-Querschnitten, Cockpitausschnitt per Boolean,
  Seitenkaesten mit Kuehlereinlass, Lackierung Carbon / Blau / Weiss, Startnummer
- Radstand 1,55 m, Spur 1,22 m vorn / 1,18 m hinten, 10-Zoll-Raeder (Reifen 0,41 m)
- Doppelquerlenker mit Pushrods und Wippen, Spurstangen, Radtraeger, Bremsscheiben,
  Zentralverschluss-Felgen
- Frontfluegel (3 Elemente) und Heckfluegel (3 Elemente) mit NACA-Profilen, Endplatten, Diffusor
- Cockpit mit Sitz, Lenkrad, Kopfstuetze; Hauptbuegel mit Streben, TSAL-Leuchte, Regenlicht
Abmessungen sind Schaetzwerte typischer FS-Autos, keine Konstruktionsdaten. Alle Masse in Metern."""
import bpy, bmesh, math, os, time
from mathutils import Vector, Matrix

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
pi = math.pi
rad = math.radians

# --- Szene leeren -----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def new_col(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

COL_BODY = new_col("Monocoque")
COL_SUSP = new_col("Fahrwerk")
COL_AERO = new_col("Aero")
COL_COCKPIT = new_col("Cockpit")
COL_ENV = new_col("Umgebung")
CUR = [COL_BODY]

# --- Materialien ------------------------------------------------------------
def mat(name, color, rough=0.5, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.04
    m.diffuse_color = (*color, 1)
    return m

def emit(name, color, strength):
    m = mat(name, (0.01, 0.01, 0.01), 0.2)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m

def carbon(name, scale=180.0, coat=1.0, rough=0.35):
    """Carbon-Koeper: Schachbrett in Objektkoordinaten, dunkle Graustufen, Klarlack."""
    m = mat(name, (0.02, 0.02, 0.022), rough, 0.0, coat)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ck = nt.nodes.new("ShaderNodeTexChecker")
    ck.inputs["Scale"].default_value = scale
    ck.inputs["Color1"].default_value = (0.012, 0.012, 0.014, 1)
    ck.inputs["Color2"].default_value = (0.045, 0.045, 0.05, 1)
    nt.links.new(tc.outputs["Object"], ck.inputs["Vector"])
    nt.links.new(ck.outputs["Color"], b.inputs["Base Color"])
    return m

CARBON = carbon("Carbon")
CARBON_MATT = carbon("Carbon_matt", 220.0, 0.0, 0.55)
BLUE = mat("Lack_Blau", (0.0, 0.13, 0.32), 0.25, 0.0, 1.0)          # TU-Wien-Blau #006699
WHITE = mat("Lack_Weiss", (0.80, 0.80, 0.80), 0.25, 0.0, 1.0)
BLACK = mat("Schwarz_matt", (0.015, 0.015, 0.015), 0.6)
TIRE = mat("Reifen", (0.018, 0.018, 0.018), 0.75)
RIM = mat("Felge", (0.10, 0.10, 0.11), 0.3, 1.0)
STEEL = mat("Stahl", (0.65, 0.65, 0.67), 0.3, 1.0)
DISC = mat("Bremsscheibe", (0.45, 0.45, 0.46), 0.45, 1.0)
RED = mat("Rot", (0.6, 0.02, 0.02), 0.35)
ALU = mat("Aluminium", (0.75, 0.76, 0.78), 0.3, 1.0)
def livery(name):
    """Lackierung ueber Objektkoordinaten (Teile liegen im Ursprung): Carbon unten (z < 0,18) und am Heck
    (x < -0,42), weisser Schraegstreifen vor dem Cockpit, sonst Blau. Kanten unabhaengig vom Mesh."""
    m = carbon(name)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    ck = nt.nodes["Checker Texture"]
    L = nt.links.new
    tc = nt.nodes["Texture Coordinate"]
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); L(tc.outputs["Object"], sep.inputs[0])
    def math_node(op, a, b_=None):
        n = nt.nodes.new("ShaderNodeMath"); n.operation = op
        for i, v in enumerate((a, b_)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]
    is_carbon = math_node('MAXIMUM', math_node('LESS_THAN', sep.outputs["Z"], 0.18),
                          math_node('LESS_THAN', sep.outputs["X"], -0.42))
    diag = math_node('ADD', sep.outputs["X"], math_node('MULTIPLY', math_node('SUBTRACT', sep.outputs["Z"], 0.3), 0.6))
    stripe = math_node('MULTIPLY', math_node('GREATER_THAN', diag, 0.55), math_node('LESS_THAN', diag, 0.66))
    paint = nt.nodes.new("ShaderNodeMix"); paint.data_type = 'RGBA'
    paint.inputs["A"].default_value = (0.0, 0.13, 0.32, 1)
    paint.inputs["B"].default_value = (0.80, 0.80, 0.80, 1)
    L(stripe, paint.inputs["Factor"])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = 'RGBA'
    L(paint.outputs["Result"], mix.inputs["A"]); L(ck.outputs["Color"], mix.inputs["B"])
    L(is_carbon, mix.inputs["Factor"])
    L(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.28
    m.diffuse_color = (0.0, 0.13, 0.32, 1)
    return m

LIVERY = livery("Lackierung")
MESH_DARK = mat("Kuehlergitter", (0.005, 0.005, 0.005), 0.8)
TSAL = emit("TSAL_gruen", (0.1, 1.0, 0.2), 12.0)
RAIN = emit("Regenlicht", (1.0, 0.03, 0.02), 8.0)

# --- Geometrie-Helfer -------------------------------------------------------
def link(ob, col=None):
    (col or CUR[0]).objects.link(ob)
    return ob

def mesh_obj(name, bm, mats, col=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
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

def blk(name, xs, ys, zs, m, bev=0.002, col=None, seg=2):
    (x0, x1), (y0, y1), (z0, z1) = xs, ys, zs
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    ob = mesh_obj(name, bm, m, col)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return bevel(ob, bev, seg) if bev else ob

def cbox(name, size, loc, m, rot=(0, 0, 0), bev=0.0015, col=None, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((*size, 1)))
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc; ob.rotation_euler = rot
    return bevel(ob, bev, seg) if bev else ob

def cyl(name, r, depth, loc, m, rot=(0, 0, 0), seg=32, r2=None, col=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r, radius2=r if r2 is None else r2, depth=depth)
    smooth_bm(bm)
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc; ob.rotation_euler = rot
    return ob

def rod(name, p1, p2, r, m, seg=12, col=None):
    """Rohr zwischen zwei Punkten."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    ob = cyl(name, r, d.length, (p1 + p2) / 2, m, seg=seg, col=col)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return ob

def tube_curve(name, pts, r, m, col=None):
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '3D'
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cd.bevel_depth = r; cd.bevel_resolution = 4; cd.resolution_u = 24
    cd.use_fill_caps = True
    ob = bpy.data.objects.new(name, cd); ob.data.materials.append(m)
    return link(ob, col)

def lathe(name, prof, m, loc, side=1, M=64, col=None):
    """Rotationskoerper um die Y-Achse aus geschlossenem Profil [(r, y), ...]; side spiegelt y."""
    bm = bmesh.new()
    rings = []
    for i in range(M):
        t = 2 * pi * i / M
        rings.append([bm.verts.new((r * math.cos(t), side * y, r * math.sin(t))) for r, y in prof])
    n = len(prof)
    for i in range(M):
        a, b = rings[i], rings[(i + 1) % M]
        for j in range(n):
            bm.faces.new((a[j], b[j], b[(j + 1) % n], a[(j + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    smooth_bm(bm, 50)
    ob = mesh_obj(name, bm, m, col)
    ob.location = loc
    return ob

def superellipse(hw, hh, N, n=3.0):
    pts = []
    for i in range(N):
        t = 2 * pi * i / N
        c, s = math.cos(t), math.sin(t)
        pts.append((hw * math.copysign(abs(c) ** (2 / n), c), hh * math.copysign(abs(s) ** (2 / n), s)))
    return pts

def interp_stations(st, per_seg):
    """Catmull-Rom ueber die Stationsparameter (Index-Raum) -> feine Stationsliste."""
    out = []
    k = len(st)
    for i in range(k - 1):
        p0, p1, p2, p3 = st[max(i - 1, 0)], st[i], st[i + 1], st[min(i + 2, k - 1)]
        for s in range(per_seg):
            t = s / per_seg
            out.append(tuple(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                                    + (-a + 3 * b - 3 * c + d) * t ** 3)
                             for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(st[-1])
    return out

def loft(name, stations, mats, yc=0.0, N=48, n=3.0, per_seg=6, col=None):
    """Rumpf aus Stationen (x, Halbbreite, z_unten, z_oben), Superellipsen-Querschnitt, Enden gedeckelt."""
    bm = bmesh.new()
    rings = []
    for x, hw, zb, zt in interp_stations(stations, per_seg):
        zc, hh = (zb + zt) / 2, (zt - zb) / 2
        rings.append([bm.verts.new((x, yc + y, zc + z)) for y, z in superellipse(hw, hh, N, n)])
    for a, b in zip(rings, rings[1:]):
        for j in range(N):
            bm.faces.new((a[j], a[(j + 1) % N], b[(j + 1) % N], b[j]))
    bm.faces.new(rings[0]); bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    smooth_bm(bm, 50)
    return mesh_obj(name, bm, mats, col)

def airfoil(name, le, chord, aoa, ys, m, t=0.12, camber=0.07, K=24, col=None):
    """Umgedrehtes NACA-4-Profil (Abtrieb), Vorderkante le=(x, z), Hinterkante um aoa Grad angehoben,
    in y von ys[0] bis ys[1] extrudiert. Fahrtrichtung +x."""
    p = 0.4
    a = rad(aoa)
    d = Vector((-math.cos(a), math.sin(a)))       # entlang der Sehne nach hinten
    nv = Vector((math.sin(a), math.cos(a)))       # senkrecht dazu (oben)
    def sec(u):
        yt = 5 * t * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)
        yc = camber / p ** 2 * (2 * p * u - u * u) if u < p else camber / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * u - u * u)
        return yt, -yc
    us = [0.5 * (1 - math.cos(pi * i / (K - 1))) for i in range(K)]
    pts = [(u, sec(u)[1] + sec(u)[0]) for u in reversed(us)] + [(u, sec(u)[1] - sec(u)[0]) for u in us[1:-1]]
    bm = bmesh.new()
    def ring(y):
        vs = []
        for u, v in pts:
            w = Vector(le) + d * (u * chord) + nv * (v * chord)
            vs.append(bm.verts.new((w.x, y, w.y)))
        return vs
    r0, r1 = ring(ys[0]), ring(ys[1])
    n = len(pts)
    for j in range(n):
        bm.faces.new((r0[j], r0[(j + 1) % n], r1[(j + 1) % n], r1[j]))
    bm.faces.new(r0); bm.faces.new(list(reversed(r1)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    smooth_bm(bm, 35)
    return mesh_obj(name, bm, m, col)

def plate(name, pts, y, thick, m, col=None):
    """Flache Platte (Endplatte) aus 2D-Umriss [(x, z)] bei y, Staerke in y."""
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y - thick / 2, z)) for x, z in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    vs = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=vs, vec=(0, thick, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bevel(mesh_obj(name, bm, m, col), 0.0015)

def apply_mods(ob):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        for mod in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)

# ===========================================================================
# MONOCOQUE + SEITENKAESTEN
# ===========================================================================
XF, XR = 0.775, -0.775            # Vorder-/Hinterachse (Radstand 1,55 m)
RW = 0.205                        # Reifenradius (10-Zoll-Rad)
YF, YR = 0.61, 0.59               # halbe Spurweite vorn/hinten

# (x, Halbbreite, z unten, z oben)
BODY = [(1.42, 0.05, 0.11, 0.20), (1.28, 0.12, 0.08, 0.28), (1.05, 0.18, 0.06, 0.37),
        (0.75, 0.23, 0.045, 0.45), (0.40, 0.29, 0.04, 0.54), (0.05, 0.32, 0.04, 0.57),
        (-0.30, 0.32, 0.04, 0.58), (-0.55, 0.29, 0.05, 0.55), (-0.82, 0.23, 0.07, 0.47),
        (-1.02, 0.15, 0.10, 0.37), (-1.12, 0.07, 0.15, 0.27)]

mono = loft("Monocoque", BODY, LIVERY)
cut = cbox("Cockpit_Ausschnitt", (0.64, 0.46, 0.8), (-0.02, 0.0, 0.58), CARBON_MATT, bev=0.12, seg=6)
mod = mono.modifiers.new("Cockpit", 'BOOLEAN')
mod.operation = 'DIFFERENCE'; mod.object = cut; mod.material_mode = 'TRANSFER'
apply_mods(mono)
bpy.data.objects.remove(cut, do_unlink=True)
mono.modifiers.new("Glatt", 'WEIGHTED_NORMAL')

for s in (-1, 1):
    SP = [(0.33, 0.06, 0.08, 0.30), (0.28, 0.11, 0.06, 0.37), (0.10, 0.115, 0.06, 0.38),
          (-0.20, 0.10, 0.06, 0.33), (-0.42, 0.06, 0.07, 0.22), (-0.50, 0.03, 0.09, 0.14)]
    loft("Seitenkasten", SP, LIVERY, yc=s * 0.44, N=40, n=3.2)
    cbox("Kuehlereinlass", (0.012, 0.15, 0.22), (0.305, s * 0.44, 0.215), MESH_DARK, bev=0.004)
    # Startnummer auf Rondell
    cyl("Startnummer_Rondell", 0.075, 0.004, (-0.02, s * 0.557, 0.24), WHITE, rot=(pi / 2, 0, 0), seg=48)
    td = bpy.data.curves.new("Startnummer", 'FONT'); td.body = "14"
    td.size = 0.085; td.extrude = 0.0008; td.align_x = 'CENTER'; td.align_y = 'CENTER'
    tob = bpy.data.objects.new("Startnummer", td); td.materials.append(BLACK)
    tob.location = (-0.02, s * 0.5605, 0.24)
    tob.rotation_euler = (pi / 2, 0, 0) if s < 0 else (pi / 2, 0, pi)
    link(tob)
    # Unterboden seitlich
    blk("Unterboden", (-0.52, 0.42), sorted((s * 0.28, s * 0.57)), (0.03, 0.04), CARBON_MATT, bev=0.002)

# ===========================================================================
# COCKPIT, HAUPTBUEGEL
# ===========================================================================
CUR[0] = COL_COCKPIT
cbox("Sitz", (0.36, 0.38, 0.06), (-0.12, 0, 0.20), BLACK, bev=0.02, seg=3)
cbox("Sitz_Lehne", (0.06, 0.38, 0.34), (-0.30, 0, 0.38), BLACK, rot=(0, rad(-25), 0), bev=0.02, seg=3)
cbox("Kopfstuetze", (0.06, 0.20, 0.13), (-0.335, 0, 0.66), BLACK, bev=0.025, seg=3)
cbox("Kopfstuetze_Halter", (0.02, 0.12, 0.16), (-0.37, 0, 0.56), CARBON_MATT, bev=0.004)
SWP = Vector((0.24, 0, 0.50))
cbox("Lenkrad", (0.025, 0.25, 0.11), SWP, CARBON, rot=(0, rad(-22), 0), bev=0.018, seg=3)
for s in (-1, 1):
    cyl("Lenkrad_Griff", 0.018, 0.12, (SWP.x - 0.01, s * 0.125, SWP.z), BLACK, seg=16)
cbox("Lenkrad_Display", (0.004, 0.08, 0.04), (SWP.x - 0.016, 0, SWP.z + 0.01), emit("Display", (0.2, 0.5, 0.9), 2.0),
     rot=(0, rad(-22), 0), bev=0)
rod("Lenksaeule", SWP + Vector((0.02, 0, -0.01)), (0.55, 0, 0.38), 0.012, ALU)

HOOP = [(-0.36, -0.27, 0.50), (-0.37, -0.22, 0.86), (-0.38, 0.0, 0.97), (-0.37, 0.22, 0.86), (-0.36, 0.27, 0.50)]
tube_curve("Hauptbuegel", HOOP, 0.0125, BLACK)
for s in (-1, 1):
    rod("Hauptbuegel_Strebe", (-0.38, s * 0.14, 0.93), (-0.80, s * 0.12, 0.47), 0.009, BLACK)
cyl("TSAL_Sockel", 0.022, 0.02, (-0.38, 0, 0.985), BLACK, seg=24)
cyl("TSAL", 0.02, 0.035, (-0.38, 0, 1.012), TSAL, seg=24)

# ===========================================================================
# FAHRWERK: Raeder, Querlenker, Pushrods
# ===========================================================================
CUR[0] = COL_SUSP
TIRE_PROF = [(0.127, -0.085), (0.150, -0.095), (0.185, -0.096), (0.200, -0.088), (0.205, -0.07),
             (0.205, 0.07), (0.200, 0.088), (0.185, 0.096), (0.150, 0.095), (0.127, 0.085)]
RIM_PROF = [(0.127, -0.088), (0.132, -0.088), (0.132, -0.080), (0.122, -0.075), (0.122, 0.075),
            (0.132, 0.080), (0.132, 0.088), (0.127, 0.088), (0.117, 0.075), (0.117, -0.075)]

def wheel(xa, yt, s):
    c = Vector((xa, s * yt, RW))
    lathe("Reifen", TIRE_PROF, TIRE, c, s, M=72)
    lathe("Felge", RIM_PROF, RIM, c, s, M=72)
    yo = s * 0.055                                     # Felgenstern aussen
    cyl("Felge_Nabe", 0.035, 0.05, c + Vector((0, yo, 0)), RIM, rot=(pi / 2, 0, 0), seg=24)
    cyl("Zentralmutter", 0.022, 0.02, c + Vector((0, s * 0.085, 0)), RED, rot=(pi / 2, 0, 0), seg=6)
    for i in range(5):
        b = 2 * pi * i / 5 + 0.3
        cbox("Felge_Speiche", (0.095, 0.014, 0.022), c + Vector((0.07 * math.cos(b), yo, -0.07 * math.sin(b))),
             RIM, rot=(0, b, 0), bev=0.004)
    cyl("Bremsscheibe", 0.095, 0.006, c + Vector((0, -s * 0.02, 0)), DISC, rot=(pi / 2, 0, 0), seg=48)
    cbox("Bremssattel", (0.05, 0.03, 0.06), c + Vector((-0.07 if xa > 0 else 0.07, -s * 0.02, 0.06)), RED, bev=0.006)

def corner(xa, yt, s, cy=0.19, front=True):
    wheel(xa, yt, s)
    yu = s * (yt - 0.10)
    cbox("Radtraeger", (0.07, 0.035, 0.22), (xa, yu, RW), ALU, bev=0.008)
    lbj, ubj = Vector((xa, s * (yt - 0.105), 0.10)), Vector((xa, s * (yt - 0.115), 0.31))
    for dx in (0.17, -0.17):
        rod("Querlenker_unten", (xa + dx, s * cy, 0.10), lbj, 0.009, BLACK)
    for dx in (0.13, -0.13):
        rod("Querlenker_oben", (xa + dx, s * (cy + 0.02), 0.29), ubj, 0.009, BLACK)
    rod("Pushrod", (xa, s * (yt - 0.13), 0.12), (xa, s * cy, 0.34), 0.008, BLACK)   # Wippe im Monocoque
    dx = -0.08 if front else 0.08
    rod("Spurstange", (xa + dx, s * cy, 0.17), (xa + dx, s * (yt - 0.11), 0.17), 0.007, STEEL)

for s in (-1, 1):
    corner(XF, YF, s, 0.17, True)
    corner(XR, YR, s, 0.21, False)

# ===========================================================================
# AERO: Frontfluegel, Heckfluegel, Diffusor
# ===========================================================================
CUR[0] = COL_AERO
FS = 0.66
airfoil("Frontfluegel_Hauptblatt", (1.74, 0.07), 0.28, 4, (-FS, FS), CARBON)
for s in (-1, 1):
    ys = sorted((s * 0.20, s * FS))
    airfoil("Frontfluegel_Flap1", (1.48, 0.115), 0.16, 22, ys, BLUE)
    airfoil("Frontfluegel_Flap2", (1.36, 0.17), 0.12, 40, ys, CARBON)
    plate("Frontfluegel_Endplatte", [(1.78, 0.03), (1.24, 0.03), (1.22, 0.26), (1.35, 0.30), (1.70, 0.18)],
          s * (FS + 0.004), 0.006, CARBON)
    plate("Frontfluegel_Halter", [(1.58, 0.09), (1.42, 0.09), (1.36, 0.14), (1.45, 0.16)], s * 0.07, 0.008, CARBON)

RS = 0.48
airfoil("Heckfluegel_Hauptblatt", (-1.02, 0.86), 0.36, 8, (-RS, RS), CARBON)
airfoil("Heckfluegel_Flap1", (-1.30, 0.95), 0.20, 30, (-RS, RS), BLUE)
airfoil("Heckfluegel_Flap2", (-1.42, 1.04), 0.14, 50, (-RS, RS), CARBON)
for s in (-1, 1):
    plate("Heckfluegel_Endplatte", [(-0.96, 0.72), (-1.58, 0.72), (-1.60, 1.20), (-1.30, 1.21), (-0.98, 1.00)],
          s * (RS + 0.004), 0.006, CARBON)
    plate("Heckfluegel_Stuetze", [(-0.98, 0.30), (-1.10, 0.28), (-1.14, 0.90), (-1.04, 0.90)], s * 0.12, 0.008, CARBON)
cbox("Regenlicht", (0.02, 0.10, 0.04), (-1.125, 0, 0.62), RAIN, bev=0.004)
cbox("Regenlicht_Halter", (0.02, 0.24, 0.02), (-1.11, 0, 0.62), BLACK, bev=0.003)
# Diffusor zwischen den Hinterraedern
bm = bmesh.new()
v = [bm.verts.new(p) for p in ((-0.55, -0.42, 0.035), (-0.55, 0.42, 0.035), (-1.18, 0.42, 0.20), (-1.18, -0.42, 0.20))]
bm.faces.new(v)
dif = mesh_obj("Diffusor", bm, CARBON_MATT)
sol = dif.modifiers.new("Staerke", 'SOLIDIFY'); sol.thickness = 0.006
for y in (-0.42, -0.14, 0.14, 0.42):
    plate("Diffusor_Finne", [(-0.55, 0.035), (-1.18, 0.20), (-1.18, 0.05), (-0.75, 0.035)], y, 0.005, CARBON_MATT)

# ===========================================================================
# UMGEBUNG, LICHT, KAMERA
# ===========================================================================
CUR[0] = COL_ENV
FLOOR = mat("Studioboden", (0.10, 0.10, 0.105), 0.35)
bm = bmesh.new()
prof = [(-40.0, 0.0), (3.0, 0.0)] + [(3.0 + 2.0 * math.sin(a), 2.0 - 2.0 * math.cos(a))
                                     for a in [pi / 2 * i / 12 for i in range(1, 13)]] + [(5.0, 25.0)]
for i, (y, z) in enumerate(prof):                      # Hohlkehle hinten (in +y)
    bm.verts.new((-40, y, z)); bm.verts.new((40, y, z))
bm.verts.ensure_lookup_table()
for i in range(len(prof) - 1):
    a, b, c, d = bm.verts[2 * i], bm.verts[2 * i + 1], bm.verts[2 * i + 3], bm.verts[2 * i + 2]
    bm.faces.new((a, b, c, d))
for f in bm.faces:
    f.smooth = True
mesh_obj("Studio_Hohlkehle", bm, FLOOR)

def area(name, loc, rot, size, energy, color=(1, 1, 1), shape='SQUARE', size_y=None):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy; d.size = size; d.color = color
    if size_y:
        d.shape = 'RECTANGLE'; d.size_y = size_y
    o = bpy.data.objects.new(name, d)
    o.location = loc; o.rotation_euler = rot
    return link(o)

area("Softbox_oben", (0, 0, 3.4), (0, 0, 0), 4.0, 650, size_y=1.6)
area("Fuehrungslicht", (3.2, -3.0, 2.2), (rad(60), 0, rad(48)), 2.5, 320, (1.0, 0.97, 0.92))
area("Kante_hinten", (-3.0, 2.2, 1.8), (rad(-60), 0, rad(-130)), 2.0, 260, (0.85, 0.9, 1.0))

world = bpy.data.worlds.new("Welt"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.52, 0.55, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.08

def camera(name, loc, target, lens):
    t = bpy.data.objects.new(name + "_Ziel", None); t.location = target; link(t)
    cd = bpy.data.cameras.new(name); cd.lens = lens
    c = bpy.data.objects.new(name, cd); c.location = loc
    link(c)
    tc = c.constraints.new('TRACK_TO'); tc.target = t
    return c

cams = [(camera("Kamera_Schraeg_vorn", (3.3, -3.1, 1.45), (0.0, 0.0, 0.35), 45), "schraeg"),
        (camera("Kamera_Seite", (0.0, -5.6, 0.55), (0.0, 0.0, 0.45), 40), "seite"),
        (camera("Kamera_Schraeg_hinten", (-3.9, -3.0, 1.7), (-0.1, 0.0, 0.45), 42), "hinten")]
scene.camera = cams[0][0]

# --- Render / Speichern -----------------------------------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = int(os.environ.get("WB_SAMPLES", 128))
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

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "formula_student.blend"))
if not os.environ.get("WB_NORENDER"):
    for cam, suffix in cams:
        scene.camera = cam
        final = os.path.join(OUT_DIR, "review", f"render_{suffix}.png")
        scene.render.filepath = final[:-4] + "_tmp.png"   # Ziel kann von einer Vorschau gesperrt sein
        bpy.ops.render.render(write_still=True)
        for _ in range(20):
            try:
                os.replace(scene.render.filepath, final); break
            except PermissionError:
                time.sleep(0.5)
    scene.camera = cams[0][0]
print("FERTIG")
