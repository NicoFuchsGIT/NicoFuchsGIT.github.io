"""3D-Druck-Tisch: Bambu Lab H2D (mit AMS 2 Pro) und Formlabs Form 4 (mit Form Wash / Form Cure)
- procedurales Modell, nur bpy/bmesh.
Ausfuehren: blender -b -P models/3d-printing/source/build_printtable.py
Optional: WB_SAMPLES=32 fuer schnelle Vorschau, WB_NORENDER=1 um nur die .blend zu speichern.

Tisch: Nussbaum-Platte 1,90 x 0,80 m auf schwarzem Stahlgestell, Hoehe 75 cm, Ablageboden unten
mit Filamentspulen und Resin-Kartuschen; Wandregal mit Spulen dahinter.
Bambu Lab H2D (links): 492 x 514 x 626 mm, Glastuer und Glasdeckel, Bauraum mit Druckbett,
Portal und Doppel-Duesen-Druckkopf, Touchscreen, AMS 2 Pro mit 4 Spulen obenauf.
Formlabs Form 4 (Mitte): ca. 398 x 367 x 554 mm, graue Basis, orange getoente Haube, Resin-Tank,
Z-Turm mit Bauplattform, Kartusche hinten. Daneben Form Wash und Form Cure.
Masse sind Schaetzwerte nach Herstellerangaben, Details frei nachempfunden. Alle Masse in Metern."""
import bpy, bmesh, math, os, time
from mathutils import Vector, Matrix

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # models/3d-printing
pi = math.pi
rad = math.radians

# --- Szene leeren -----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def new_col(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

COL_TABLE = new_col("Drucktisch")
COL_BAMBU = new_col("Bambu_H2D")
COL_FORM = new_col("Formlabs")
COL_DECO = new_col("Deko")
COL_ENV = new_col("Umgebung")
CUR = [COL_TABLE]

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

def glass(name, color, rough=0.03):
    m = mat(name, color, rough)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Transmission Weight"].default_value = 1.0
    b.inputs["IOR"].default_value = 1.49
    m.diffuse_color = (*color, 0.4)
    return m

def emit(name, color, strength):
    m = mat(name, (0.01, 0.01, 0.01), 0.2)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m

def ramp_mat(name, coord_chain, colors, rough=0.5, metal=0.0):
    """Material, dessen Grundfarbe ueber eine ColorRamp aus einem Faktor kommt."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    fac = coord_chain(nt)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
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

def noise_chain(scale, detail=6.0):
    def chain(nt):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        return n.outputs["Fac"]
    return chain

WALNUT = [(0.05, 0.025, 0.012), (0.14, 0.07, 0.035), (0.26, 0.14, 0.065)]
W = {a: wood("Nussbaum_" + a, *WALNUT, a) for a in "XY"}
CONCRETE_WALL, _, _, _ = ramp_mat("Beton_Wand", noise_chain(6.0, 10),
                                  [(0.35, (0.28, 0.29, 0.30)), (0.65, (0.45, 0.46, 0.47))], rough=0.9)
CONCRETE_FLOOR, _, _, _ = ramp_mat("Beton_Boden", noise_chain(3.0, 12),
                                   [(0.3, (0.22, 0.22, 0.21)), (0.7, (0.42, 0.41, 0.39))], rough=0.75)
PEI, _, _, _ = ramp_mat("PEI_Platte", noise_chain(400.0, 2),
                        [(0.4, (0.32, 0.22, 0.08)), (0.6, (0.45, 0.32, 0.12))], rough=0.7, metal=0.3)

BLACK_STEEL = mat("Stahl_schwarz", (0.02, 0.02, 0.02), 0.45, 0.6)
STEEL = mat("Stahl_blank", (0.7, 0.7, 0.72), 0.22, 1.0)
ALU = mat("Aluminium", (0.78, 0.79, 0.8), 0.3, 1.0)
BRASS = mat("Messing", (0.75, 0.55, 0.25), 0.3, 1.0)
BLACK_PLASTIC = mat("Kunststoff_schwarz", (0.012, 0.012, 0.012), 0.5)
GLOSS_BLACK = mat("Hochglanz_schwarz", (0.005, 0.005, 0.005), 0.08)
RUBBER = mat("Gummi", (0.02, 0.02, 0.02), 0.9)
H2D_BODY = mat("H2D_Gehaeuse", (0.03, 0.032, 0.035), 0.45, 0.1)
H2D_SIDE = mat("H2D_Seitenblende", (0.075, 0.078, 0.082), 0.35, 0.3)
H2D_INNER = mat("H2D_Bauraum", (0.05, 0.05, 0.052), 0.7)
TOOLHEAD = mat("Druckkopf", (0.16, 0.165, 0.17), 0.4)
CARBON = mat("Carbonstange", (0.03, 0.03, 0.03), 0.3, 0.2)
AMS_BODY = mat("AMS_Gehaeuse", (0.06, 0.062, 0.066), 0.45)
SMOKE = glass("Glas_rauch", (0.55, 0.56, 0.58), 0.02)
AMS_LID = glass("AMS_Deckel", (0.35, 0.36, 0.38), 0.05)
ORANGE_COVER = glass("Haube_orange", (1.0, 0.30, 0.02), 0.04)
FORM_BASE = mat("Form_Basis", (0.30, 0.31, 0.32), 0.35, 0.6)
FORM_DARK = mat("Form_dunkelgrau", (0.08, 0.085, 0.09), 0.45)
RESIN = mat("Resin_grau", (0.30, 0.31, 0.32), 0.25)
RESIN_PART = mat("Resin_Teil", (0.36, 0.37, 0.38), 0.4)
WASH_BODY = mat("Wash_Cure_Gehaeuse", (0.34, 0.35, 0.36), 0.45, 0.3)
SCREEN = emit("Display", (0.10, 0.22, 0.30), 1.2)
SCREEN_FORM = emit("Display_Form", (0.55, 0.58, 0.62), 0.5)
LED = emit("LED_Leiste", (1.0, 0.95, 0.88), 25.0)
LED_GREEN = emit("LED_gruen", (0.1, 1.0, 0.25), 6.0)
PTFE = glass("PTFE_Schlauch", (0.92, 0.92, 0.9), 0.35)
BOTTLE = mat("Flasche_weiss", (0.85, 0.86, 0.87), 0.35)
CAP_BLUE = mat("Deckel_blau", (0.03, 0.15, 0.55), 0.4)
GLOVES = mat("Karton_blau", (0.05, 0.25, 0.6), 0.7)
CARDBOARD = mat("Karton", (0.55, 0.40, 0.25), 0.85)
HOLE = mat("Spulenloch", (0.0, 0.0, 0.0), 1.0)
PLA = {n: mat("PLA_" + n, c, 0.35) for n, c in {
    "weiss": (0.85, 0.85, 0.83), "schwarz": (0.02, 0.02, 0.02), "orange": (0.95, 0.30, 0.02),
    "blau": (0.02, 0.15, 0.6), "gruen": (0.05, 0.5, 0.12), "rot": (0.65, 0.03, 0.03),
    "grau": (0.25, 0.26, 0.27), "gelb": (0.95, 0.7, 0.03), "tuerkis": (0.02, 0.5, 0.5)}.items()}

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

def blk(name, xs, ys, zs, m, bev=0.002, col=None, seg=2):
    """Quader aus Min/Max-Koordinaten."""
    (x0, x1), (y0, y1), (z0, z1) = xs, ys, zs
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    ob = mesh_obj(name, bm, m, col)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return bevel(ob, bev, seg) if bev else ob

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

def shell(name, xs, ys, zs, m, thick=0.004, bev=0.015, col=None):
    """Nach unten offene Haube (Quader ohne Boden, Kanten gerundet, Wandstaerke nach innen)."""
    (x0, x1), (y0, y1), (z0, z1) = xs, ys, zs
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context='FACES')
    ob = mesh_obj(name, bm, m, col)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    bevel(ob, bev, 5)
    sol = ob.modifiers.new("Wand", 'SOLIDIFY')
    sol.thickness = thick; sol.offset = 1.0
    return ob

def tube_curve(name, pts, r, m, col=None):
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '3D'
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cd.bevel_depth = r; cd.bevel_resolution = 3; cd.resolution_u = 16
    ob = bpy.data.objects.new(name, cd); ob.data.materials.append(m)
    return link(ob, col)

AXIS = {'X': ((0, pi / 2, 0), Vector((1, 0, 0))), 'Y': ((pi / 2, 0, 0), Vector((0, 1, 0))),
        'Z': ((0, 0, 0), Vector((0, 0, 1)))}

def spool(name, c, axis, fil, flange=BLACK_PLASTIC, R=0.1, w=0.066, col=None):
    """Filamentspule: zwei Flansche, Wicklung, Nabe mit dunklem Loch."""
    rot, d = AXIS[axis]
    c = Vector(c)
    for s in (-1, 1):
        cyl(name + "_Flansch", R, 0.004, c + d * s * (w / 2 - 0.002), flange, rot, seg=64, col=col)
    cyl(name + "_Filament", R * 0.9, w - 0.008, c, fil, rot, seg=64, col=col)
    cyl(name + "_Nabe", 0.04, w - 0.006, c, flange, rot, seg=32, col=col)
    cyl(name + "_Loch", 0.027, w + 0.001, c, HOLE, rot, seg=24, col=col)

# ===========================================================================
# TISCH
# ===========================================================================
TOP = 0.75                        # Oberkante Tischplatte
TT = 0.04
TX, TY = (-0.95, 0.95), (-0.40, 0.40)
blk("Tischplatte", TX, TY, (TOP - TT, TOP), W["X"], bev=0.004)
LEG = 0.04
LX = [(TX[0] + 0.03, TX[0] + 0.03 + LEG), (TX[1] - 0.03 - LEG, TX[1] - 0.03)]
LY = [(TY[0] + 0.03, TY[0] + 0.03 + LEG), (TY[1] - 0.03 - LEG, TY[1] - 0.03)]
for xs in LX:
    for ys in LY:
        blk("Bein", xs, ys, (0.012, TOP - TT), BLACK_STEEL, bev=0.003)
        cyl("Stellfuss", 0.018, 0.012, ((xs[0] + xs[1]) / 2, (ys[0] + ys[1]) / 2, 0.006), RUBBER)
for z0, h in ((TOP - TT - 0.06, 0.06), (0.12, 0.04)):           # Zarge oben, Rahmen unten
    for ys in LY:
        blk("Rahmen_X", (LX[0][1], LX[1][0]), ys, (z0, z0 + h), BLACK_STEEL, bev=0.003)
    for xs in LX:
        blk("Rahmen_Y", xs, (LY[0][1], LY[1][0]), (z0, z0 + h), BLACK_STEEL, bev=0.003)
blk("Ablageboden", (LX[0][0], LX[1][1]), (LY[0][0], LY[1][1]), (0.16, 0.18), W["X"], bev=0.002)
SHELF_Z = 0.18

# ===========================================================================
# BAMBU LAB H2D (+ AMS 2 Pro)
# ===========================================================================
CUR[0] = COL_BAMBU
HW, HD, HH = 0.492, 0.514, 0.626
HX = (-0.905, -0.905 + HW)
HCX = (HX[0] + HX[1]) / 2
HY = (0.33 - HD, 0.33)
Z0 = TOP + 0.012                  # Gehaeuseunterkante (auf Fuessen)
Z1 = TOP + HH - 0.006             # Oberkante Gehaeuse unter dem Glasdeckel
BASE_H = 0.115
WALL = 0.032
for x in (HX[0] + 0.05, HX[1] - 0.05):
    for y in (HY[0] + 0.05, HY[1] - 0.05):
        cyl("H2D_Fuss", 0.02, 0.012, (x, y, TOP + 0.006), RUBBER)

blk("H2D_Sockel", HX, HY, (Z0, Z0 + BASE_H), H2D_BODY, bev=0.01, seg=4)
for xs, sx in (((HX[0], HX[0] + WALL), -1), ((HX[1] - WALL, HX[1]), 1)):
    blk("H2D_Seitenwand", xs, HY, (Z0 + BASE_H - 0.01, Z1), H2D_BODY, bev=0.01, seg=4)
    xo = xs[0] if sx < 0 else xs[1]
    blk("H2D_Seitenblende", (xo - 0.003, xo) if sx < 0 else (xo, xo + 0.003),
        (HY[0] + 0.05, HY[1] - 0.05), (Z0 + 0.07, Z1 - 0.06), H2D_SIDE, bev=0.002)
blk("H2D_Rueckwand", (HX[0] + WALL, HX[1] - WALL), (HY[1] - WALL, HY[1]),
    (Z0 + BASE_H - 0.01, Z1), H2D_BODY, bev=0.004)
for ys in ((HY[0], HY[0] + 0.035), (HY[1] - 0.035, HY[1])):          # Deckelrahmen vorn/hinten
    blk("H2D_Deckelrahmen", HX, ys, (Z1 - 0.035, Z1), H2D_BODY, bev=0.006)
blk("H2D_Bauraum_Boden", (HX[0] + WALL, HX[1] - WALL), (HY[0] + 0.01, HY[1] - WALL),
    (Z0 + BASE_H - 0.004, Z0 + BASE_H), H2D_INNER, bev=0)
blk("H2D_Bauraum_Rueckseite", (HX[0] + WALL, HX[1] - WALL), (HY[1] - WALL - 0.002, HY[1] - WALL),
    (Z0 + BASE_H, Z1 - 0.035), H2D_INNER, bev=0)

# Glastuer mit Rahmen, Griff
DZ = (Z0 + BASE_H + 0.004, Z1 - 0.004)
DX = (HX[0] + 0.006, HX[1] - 0.006)
yf = HY[0]
blk("H2D_Tuerglas", DX, (yf - 0.006, yf - 0.002), DZ, SMOKE, bev=0.004)
for xs in ((DX[0], DX[0] + 0.022), (DX[1] - 0.022, DX[1])):
    blk("H2D_Tuerrahmen", xs, (yf - 0.0075, yf - 0.0055), DZ, GLOSS_BLACK, bev=0.001)
for zs in ((DZ[0], DZ[0] + 0.022), (DZ[1] - 0.022, DZ[1])):
    blk("H2D_Tuerrahmen", DX, (yf - 0.0075, yf - 0.0055), zs, GLOSS_BLACK, bev=0.001)
blk("H2D_Tuergriff", (DX[1] - 0.05, DX[1] - 0.035), (yf - 0.024, yf - 0.0075),
    (DZ[0] + 0.18, DZ[0] + 0.33), BLACK_PLASTIC, bev=0.004)
# Glasdeckel
blk("H2D_Deckelglas", (HX[0] + 0.008, HX[1] - 0.008), (HY[0] + 0.008, HY[1] - 0.008),
    (Z1, Z1 + 0.006), SMOKE, bev=0.003)
blk("H2D_Deckelgriff", (HCX - 0.06, HCX + 0.06), (HY[0] + 0.01, HY[0] + 0.03),
    (Z1 + 0.006, Z1 + 0.014), BLACK_PLASTIC, bev=0.003)

# Frontblende unten: Touchscreen, Status-LED
blk("H2D_Frontblende", (HX[0] + 0.01, HX[1] - 0.01), (yf - 0.003, yf), (Z0 + 0.012, Z0 + BASE_H - 0.012),
    GLOSS_BLACK, bev=0.002)
cbox("H2D_Touchscreen_Rahmen", (0.13, 0.008, 0.078), (HX[0] + 0.105, yf - 0.006, Z0 + BASE_H / 2),
     GLOSS_BLACK, rot=(rad(-12), 0, 0), bev=0.003)
cbox("H2D_Touchscreen", (0.11, 0.002, 0.062), (HX[0] + 0.105, yf - 0.0105, Z0 + BASE_H / 2 + 0.001),
     SCREEN, rot=(rad(-12), 0, 0), bev=0)
cbox("H2D_LED", (0.03, 0.002, 0.003), (HX[1] - 0.06, yf - 0.0035, Z0 + BASE_H / 2), LED_GREEN, bev=0)

# Bauraum: Bett, Z-Spindeln, Portal, Druckkopf, LED-Leiste
IX = (HX[0] + WALL, HX[1] - WALL)
FLOOR = Z0 + BASE_H
BED_Z = FLOOR + 0.22
BCY = (HY[0] + HY[1]) / 2 - 0.01
blk("H2D_Heizbett", (HCX - 0.18, HCX + 0.18), (BCY - 0.175, BCY + 0.175), (BED_Z - 0.02, BED_Z - 0.003),
    BLACK_PLASTIC, bev=0.003)
blk("H2D_Druckplatte", (HCX - 0.175, HCX + 0.175), (BCY - 0.168, BCY + 0.168), (BED_Z - 0.003, BED_Z),
    PEI, bev=0.0008)
for x, y in ((HCX - 0.19, HY[1] - 0.07), (HCX + 0.19, HY[1] - 0.07), (HCX, HY[0] + 0.06)):
    cyl("H2D_Z_Spindel", 0.006, Z1 - 0.04 - FLOOR, (x, y, (FLOOR + Z1 - 0.04) / 2), STEEL, seg=16)
GZ = FLOOR + 0.40
for x in (IX[0] + 0.02, IX[1] - 0.02):
    cyl("H2D_Y_Fuehrung", 0.006, HD - 0.08, (x, BCY, GZ + 0.01), STEEL, rot=(pi / 2, 0, 0), seg=16)
    blk("H2D_Y_Schlitten", (x - 0.015, x + 0.015), (BCY - 0.05, BCY - 0.01), (GZ - 0.005, GZ + 0.03),
        BLACK_PLASTIC, bev=0.003)
cyl("H2D_X_Stange", 0.008, IX[1] - IX[0] - 0.04, (HCX, BCY - 0.03, GZ + 0.012), CARBON,
    rot=(0, pi / 2, 0), seg=20)
THX = HCX - 0.04
blk("H2D_Druckkopf", (THX - 0.055, THX + 0.055), (BCY - 0.07, BCY + 0.01), (GZ - 0.085, GZ + 0.04),
    TOOLHEAD, bev=0.012, seg=4)
blk("H2D_Druckkopf_Front", (THX - 0.045, THX + 0.045), (BCY - 0.073, BCY - 0.07), (GZ - 0.07, GZ + 0.025),
    BLACK_PLASTIC, bev=0.002)
cyl("H2D_Luefter", 0.022, 0.003, (THX, BCY - 0.0745, GZ - 0.02), GLOSS_BLACK, rot=(pi / 2, 0, 0))
for dx, dz in ((-0.02, -0.006), (0.02, 0.0)):         # linke Duese abgesenkt
    cyl("H2D_Duese", 0.004, 0.012, (THX + dx, BCY - 0.03, GZ - 0.091 + dz), BRASS, seg=12, r2=0.0012)
blk("H2D_LED_Leiste", (IX[0] + 0.03, IX[1] - 0.03), (HY[0] + 0.035, HY[0] + 0.045), (Z1 - 0.04, Z1 - 0.036),
    LED, bev=0)
# Druckteile auf dem Bett
cyl("Druck_Vase", 0.035, 0.07, (HCX - 0.04, BCY - 0.03, BED_Z + 0.035), PLA["orange"], seg=12, r2=0.045)
blk("Druck_Teil", (HCX + 0.06, HCX + 0.12), (BCY + 0.02, BCY + 0.08), (BED_Z, BED_Z + 0.02), PLA["tuerkis"],
    bev=0.002)

# AMS 2 Pro auf dem Deckel
AW, AD = 0.372, 0.28
AX = (HCX - AW / 2, HCX + AW / 2)
AY = (HY[0] + 0.12, HY[0] + 0.12 + AD)
AZ = Z1 + 0.006
blk("AMS_Unterteil", AX, AY, (AZ, AZ + 0.115), AMS_BODY, bev=0.012, seg=4)
shell("AMS_Deckel", (AX[0] + 0.004, AX[1] - 0.004), (AY[0] + 0.004, AY[1] - 0.004), (AZ + 0.112, AZ + 0.233),
      AMS_LID, thick=0.003, bev=0.02)
for i, (c, xo) in enumerate(zip(("weiss", "schwarz", "orange", "blau"), (-0.135, -0.045, 0.045, 0.135))):
    spool(f"AMS_Spule{i + 1}", (HCX + xo, (AY[0] + AY[1]) / 2, AZ + 0.112), 'X', PLA[c],
          flange=GLOSS_BLACK, R=0.095, w=0.07)
    cbox("AMS_Slot_LED", (0.02, 0.002, 0.004), (HCX + xo, AY[0] - 0.001, AZ + 0.09), LED_GREEN, bev=0)
for i, xo in enumerate((-0.135, -0.045, 0.045, 0.135)):     # PTFE-Schlaeuche zur Rueckseite
    x = HCX + xo * 0.5
    tube_curve("PTFE", [(x, AY[1] - 0.01, AZ + 0.06), (x + xo * 0.2, HY[1] + 0.04, AZ + 0.02),
                        (HCX + 0.12 + i * 0.012, HY[1] + 0.012, Z1 - 0.12)], 0.002, PTFE)

# ===========================================================================
# FORMLABS FORM 4 + FORM WASH + FORM CURE
# ===========================================================================
CUR[0] = COL_FORM
FW, FD = 0.398, 0.367
FCX = 0.0
FX = (FCX - FW / 2, FCX + FW / 2)
FY = (0.33 - FD, 0.33)
FB = TOP + 0.21                   # Oberkante Basis
FTOP = TOP + 0.554
blk("Form4_Basis", FX, FY, (TOP + 0.006, FB), FORM_BASE, bev=0.012, seg=4)
for x in (FX[0] + 0.04, FX[1] - 0.04):
    for y in (FY[0] + 0.04, FY[1] - 0.04):
        cyl("Form4_Fuss", 0.015, 0.006, (x, y, TOP + 0.003), RUBBER)
blk("Form4_Fuge", (FX[0] + 0.012, FX[1] - 0.012), (FY[0] - 0.0005, FY[0] + 0.002), (FB - 0.03, FB - 0.027),
    FORM_DARK, bev=0)
cbox("Form4_Touchscreen_Rahmen", (0.125, 0.006, 0.08), (FX[0] + 0.1, FY[0] - 0.002, TOP + 0.105),
     GLOSS_BLACK, bev=0.003)
cbox("Form4_Touchscreen", (0.11, 0.002, 0.066), (FX[0] + 0.1, FY[0] - 0.0052, TOP + 0.105), SCREEN_FORM, bev=0)
cyl("Form4_Taste", 0.008, 0.004, (FX[1] - 0.05, FY[0] - 0.001, TOP + 0.105), FORM_DARK, rot=(pi / 2, 0, 0))
# orange Haube (vorn), Kartusche dahinter
CY = (FY[0] + 0.004, FY[1] - 0.115)
shell("Form4_Haube", (FX[0] + 0.006, FX[1] - 0.006), CY, (FB, FTOP), ORANGE_COVER, thick=0.004, bev=0.025)
blk("Form4_Haubenkante", (FX[0] + 0.006, FX[1] - 0.006), (CY[0], CY[1]), (FB - 0.004, FB), FORM_DARK,
    bev=0.002)
blk("Form4_Kartusche", (FCX - 0.045, FCX + 0.045), (FY[1] - 0.10, FY[1] - 0.02), (FB, FB + 0.23),
    FORM_DARK, bev=0.012, seg=3)
cyl("Form4_Kartusche_Ventil", 0.012, 0.012, (FCX, FY[1] - 0.06, FB + 0.236), BLACK_PLASTIC, seg=20)
# Inneres: Tank, Z-Turm, Plattform mit Druckteil
TCY = (CY[0] + CY[1]) / 2 - 0.01
blk("Form4_Tank", (FCX - 0.16, FCX + 0.16), (TCY - 0.105, TCY + 0.105), (FB, FB + 0.035), FORM_DARK,
    bev=0.004)
blk("Form4_Resin", (FCX - 0.15, FCX + 0.15), (TCY - 0.095, TCY + 0.095), (FB + 0.026, FB + 0.028), RESIN,
    bev=0)
blk("Form4_Z_Turm", (FCX - 0.03, FCX + 0.03), (CY[1] - 0.05, CY[1] - 0.008), (FB, FTOP - 0.03), FORM_BASE,
    bev=0.004)
PZ = FB + 0.17
blk("Form4_Arm", (FCX - 0.025, FCX + 0.025), (TCY, CY[1] - 0.05), (PZ, PZ + 0.03), FORM_BASE, bev=0.003)
blk("Form4_Plattform", (FCX - 0.1, FCX + 0.1), (TCY - 0.065, TCY + 0.065), (PZ - 0.014, PZ), ALU, bev=0.002)
cyl("Form4_Griff", 0.012, 0.025, (FCX, TCY - 0.04, PZ + 0.012), FORM_DARK, rot=(pi / 2, 0, 0), seg=20)
for i, (dx, dy) in enumerate(((-0.04, -0.02), (0.0, 0.02), (0.04, -0.01))):
    cyl("Form4_Stuetze", 0.0012, 0.02, (FCX + dx, TCY + dy, PZ - 0.024), RESIN_PART, seg=8)
cyl("Form4_Druckteil", 0.05, 0.055, (FCX, TCY, PZ - 0.0615), RESIN_PART, seg=6)

# Form Wash
WX = (0.27, 0.54)
WY = (0.33 - 0.30, 0.33)
blk("FormWash_Gehaeuse", WX, WY, (TOP, TOP + 0.385), WASH_BODY, bev=0.012, seg=4)
blk("FormWash_Deckel", (WX[0] + 0.004, WX[1] - 0.004), (WY[0] + 0.004, WY[1] - 0.004),
    (TOP + 0.385, TOP + 0.405), FORM_DARK, bev=0.008, seg=3)
blk("FormWash_Mulde", ((WX[0] + WX[1]) / 2 - 0.05, (WX[0] + WX[1]) / 2 + 0.05), (WY[0] + 0.004, WY[0] + 0.03),
    (TOP + 0.395, TOP + 0.406), BLACK_PLASTIC, bev=0.002)
cyl("FormWash_Drehknopf", 0.022, 0.018, ((WX[0] + WX[1]) / 2, WY[0] - 0.009, TOP + 0.3), FORM_DARK,
    rot=(pi / 2, 0, 0))
cbox("FormWash_Display", (0.06, 0.002, 0.025), ((WX[0] + WX[1]) / 2, WY[0] - 0.001, TOP + 0.345),
     SCREEN_FORM, bev=0)
# Form Cure mit orangem Fenster
CX_ = (0.60, 0.87)
CYY = (0.33 - 0.30, 0.33)
blk("FormCure_Gehaeuse", CX_, CYY, (TOP, TOP + 0.33), WASH_BODY, bev=0.012, seg=4)
blk("FormCure_Deckel", (CX_[0] + 0.004, CX_[1] - 0.004), (CYY[0] + 0.004, CYY[1] - 0.004),
    (TOP + 0.33, TOP + 0.35), FORM_DARK, bev=0.008, seg=3)
blk("FormCure_Fenster", (CX_[0] + 0.04, CX_[1] - 0.04), (CYY[0] + 0.04, CYY[1] - 0.04),
    (TOP + 0.3505, TOP + 0.3525), ORANGE_COVER, bev=0.002)
cyl("FormCure_Drehknopf", 0.02, 0.016, ((CX_[0] + CX_[1]) / 2, CYY[0] - 0.008, TOP + 0.26), FORM_DARK,
    rot=(pi / 2, 0, 0))

# ===========================================================================
# DEKO: Spulen, Flaschen, Werkzeug, Wandregal
# ===========================================================================
CUR[0] = COL_DECO
# Ablageboden: Spulen aufrecht, Resin-Kartuschen, Kiste
for i, (x, c) in enumerate(((-0.80, "gruen"), (-0.72, "rot"), (-0.64, "grau"), (-0.56, "gelb"))):
    spool(f"Ablage_Spule{i + 1}", (x, -0.02, SHELF_Z + 0.1), 'X', PLA[c])
for i, x in enumerate((-0.30, -0.19)):
    blk("Resin_Kartusche", (x - 0.045, x + 0.045), (-0.16, 0.06), (SHELF_Z, SHELF_Z + 0.24), FORM_DARK,
        bev=0.012, seg=3)
    cyl("Resin_Kartusche_Ventil", 0.012, 0.012, (x, -0.05, SHELF_Z + 0.246), BLACK_PLASTIC, seg=20)
blk("Karton", (0.25, 0.70), (-0.25, 0.25), (SHELF_Z, SHELF_Z + 0.26), CARDBOARD, bev=0.003)
# Tischplatte vorn: Spachtel, Seitenschneider, IPA-Flasche, Handschuhe, Ersatzspule liegend
cbox("Spachtel_Griff", (0.10, 0.025, 0.014), (-0.62, -0.31, TOP + 0.007), BLACK_PLASTIC, rot=(0, 0, rad(18)),
     bev=0.005)
cbox("Spachtel_Klinge", (0.06, 0.04, 0.0015), (-0.545, -0.285, TOP + 0.002), STEEL, rot=(0, 0, rad(18)),
     bev=0.0005)
for s in (-1, 1):
    cbox("Seitenschneider_Griff", (0.09, 0.012, 0.01), (-0.33, -0.30 + s * 0.012, TOP + 0.005), PLA["gruen"],
         rot=(0, 0, rad(-30 + s * 6)), bev=0.004)
cbox("Seitenschneider_Kopf", (0.03, 0.02, 0.008), (-0.385, -0.268, TOP + 0.004), BLACK_STEEL,
     rot=(0, 0, rad(-30)), bev=0.002)
cyl("IPA_Flasche", 0.042, 0.2, (0.42, -0.2, TOP + 0.1), BOTTLE, seg=40)
cyl("IPA_Hals", 0.042, 0.03, (0.42, -0.2, TOP + 0.215), BOTTLE, seg=40, r2=0.016)
cyl("IPA_Deckel", 0.017, 0.022, (0.42, -0.2, TOP + 0.24), CAP_BLUE, seg=24)
blk("Handschuhbox", (0.62, 0.86), (-0.30, -0.17), (TOP, TOP + 0.09), GLOVES, bev=0.003)
blk("Handschuhbox_Schlitz", (0.69, 0.79), (-0.26, -0.21), (TOP + 0.09, TOP + 0.091), PLA["weiss"], bev=0)
spool("Tisch_Spule", (0.14, -0.27, TOP + 0.033), 'Z', PLA["orange"], R=0.1, w=0.066)
# Wandregal mit Spulen
RZ = 1.66
blk("Wandregal", (-0.70, 0.70), (0.23, 0.45), (RZ - 0.025, RZ), W["X"], bev=0.003)
for x in (-0.55, 0.55):
    blk("Regalwinkel_V", (x - 0.015, x + 0.015), (0.44, 0.45), (RZ - 0.2, RZ - 0.025), BLACK_STEEL, bev=0.001)
    blk("Regalwinkel_H", (x - 0.015, x + 0.015), (0.25, 0.45), (RZ - 0.03, RZ - 0.025), BLACK_STEEL, bev=0.001)
for i, c in enumerate(("weiss", "schwarz", "grau", "blau", "tuerkis", "gruen", "gelb", "orange", "rot")):
    spool(f"Regal_Spule{i + 1}", (-0.36 + i * 0.09, 0.34, RZ + 0.1), 'X', PLA[c])

# ===========================================================================
# UMGEBUNG, LICHT, KAMERA
# ===========================================================================
CUR[0] = COL_ENV
blk("Boden", (-5, 5), (-6, 1.0), (-0.02, 0.0), CONCRETE_FLOOR, 0)
blk("Wand", (-5, 5), (0.45, 0.50), (0.0, 3.2), CONCRETE_WALL, 0)
blk("Sockelleiste", (-5, 5), (0.44, 0.45), (0.0, 0.08), BLACK_PLASTIC, 0)

def area(name, loc, rot, size, energy, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc; o.rotation_euler = rot
    return link(o)

area("Deckenlicht", (0.0, -1.0, 3.0), (0, 0, 0), 3.0, 150, (1.0, 0.95, 0.88))
area("Fuehrungslicht", (-1.9, -2.6, 2.0), (rad(65), 0, rad(-35)), 2.0, 100)
area("Fuelllicht", (2.0, -2.3, 1.6), (rad(70), 0, rad(45)), 1.5, 55, (0.85, 0.9, 1.0))

world = bpy.data.worlds.new("Welt"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.52, 0.55, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12

def empty(name, loc, col=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc; e.empty_display_size = 0.05
    return link(e, col)

def camera(name, loc, target, lens):
    t = empty(name + "_Ziel", target)
    cd = bpy.data.cameras.new(name); cd.lens = lens
    c = bpy.data.objects.new(name, cd); c.location = loc
    link(c)
    tc = c.constraints.new('TRACK_TO'); tc.target = t
    return c

cam_34 = camera("Kamera_Schraeg", (-1.75, -2.85, 1.75), (-0.05, 0.0, 1.05), 30)
cam_front = camera("Kamera_Front", (0.0, -3.5, 1.3), (0.0, 0.0, 1.05), 32)
scene.camera = cam_34

# --- Render / Speichern -----------------------------------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = int(os.environ.get("WB_SAMPLES", 128))
scene.cycles.use_denoising = True
scene.cycles.transmission_bounces = 16
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

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "printtable.blend"))
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
