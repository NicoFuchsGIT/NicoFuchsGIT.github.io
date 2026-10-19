"""Legend Monolift (Model 3908 layout) + Eleiko IPF powerlifting plates, set up like the Barbellscan study.
Run: blender -b -P build_monolift.py   (writes monolift.blend + render_*.png next to this file)

Barbellscan facts used (docs/PRD.md, src/barbellscan/simulate.py, config/bars.yaml):
  - Eleiko Competition Power Bar: 2200 mm, shaft 29 mm, shaft length 1310 mm, 20 kg
  - hooks at +-371 mm from the bar centre
  - yellow balls (d 50 mm) on both sleeve ends, magenta tape (40 mm) at bar centre
  - ArUco DICT_4X4_50 id 0, 100 mm + 10 mm white border, centre 140 mm above the bar axis
  - load = 25 + 50 * n kg with n red 25 kg plates per side incl. collars (225 kg -> n = 4)
Axes: X across the rack, Y depth (lifter side is -Y, spotter side +Y), Z up. Units: metres.
"""
import bpy, bmesh, math, os
from mathutils import Matrix

OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- helpers ----------
def mat(name, color, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m

def finish(name, bm, m, loc, bevel):
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:  # keep hard edges hard (rims, box corners)
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(35):
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.location = loc
    me.materials.append(m)
    if bevel:
        md = ob.modifiers.new("Bevel", 'BEVEL')
        md.width, md.segments, md.angle_limit = bevel, 2, math.radians(35)
    return ob

def box(name, size, loc, m, bevel=0.002):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    return finish(name, bm, m, loc, bevel)

ROT = {'x': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'z': Matrix.Identity(4)}

def cyl(name, r, length, axis, loc, m, bevel=0.0015, seg=48):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r,
                          depth=length, matrix=ROT[axis])
    return finish(name, bm, m, loc, bevel)

def sphere(name, r, loc, m):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
    return finish(name, bm, m, loc, 0)

def prism(name, pts, t, c0, m, bevel=0.0015, plane='yz'):
    """Extrude a 2D polygon by t. plane 'yz': pts=(y,z), thickness along X centred on c0.
    plane 'xz': pts=(x,z), thickness along Y centred on c0."""
    bm = bmesh.new()
    if plane == 'yz':
        vs = [bm.verts.new((c0 - t / 2, a, b)) for a, b in pts]
        d = (t, 0, 0)
    else:
        vs = [bm.verts.new((a, c0 - t / 2, b)) for a, b in pts]
        d = (0, t, 0)
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, verts=[g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)], vec=d)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, m, (0, 0, 0), bevel)

def lathe(name, pts, m, loc, bevel=0.001, steps=96):
    """Revolve a closed (x, r) profile around the X axis."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, r, 0)) for x, r in pts]
    es = [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=2 * math.pi,
                   steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, m, loc, bevel)

def empty(name):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    return e

def parent(obs, p):
    bpy.context.view_layer.update()
    for o in obs:
        o.parent = p
        o.matrix_parent_inverse = p.matrix_world.inverted()

def text(body, size, loc, side, m):
    cu = bpy.data.curves.new(body, 'FONT')
    cu.body, cu.size, cu.extrude = body, size, 0.0003
    cu.align_x, cu.align_y = 'CENTER', 'CENTER'
    ob = bpy.data.objects.new("txt_" + body, cu)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (math.pi / 2, 0, side * math.pi / 2)  # reads upright, facing +-X
    cu.materials.append(m)
    return ob

# ---------- materials ----------
BLACK = mat("Frame_black_powdercoat", (0.015, 0.015, 0.02), 0.0, 0.4)
CHROME = mat("Chrome", (0.9, 0.9, 0.92), 1.0, 0.08)
STEEL = mat("Steel_sleeve", (0.82, 0.82, 0.84), 1.0, 0.22)
SHAFT = mat("Steel_shaft", (0.75, 0.75, 0.77), 1.0, 0.3)
KNURL = mat("Steel_knurl", (0.62, 0.62, 0.64), 1.0, 0.45)
_n, _l = KNURL.node_tree.nodes, KNURL.node_tree.links
_tc, _vo, _bp = _n.new('ShaderNodeTexCoord'), _n.new('ShaderNodeTexVoronoi'), _n.new('ShaderNodeBump')
_vo.inputs['Scale'].default_value = 900
_bp.inputs['Strength'].default_value = 0.7
_bp.inputs['Distance'].default_value = 0.0005
_l.new(_tc.outputs['Object'], _vo.inputs['Vector'])
_l.new(_vo.outputs['Distance'], _bp.inputs['Height'])
_l.new(_bp.outputs['Normal'], _n["Principled BSDF"].inputs['Normal'])
RED = mat("Eleiko_IPF_red", (0.5, 0.012, 0.012), 0.0, 0.32)       # sim: BGR (35,35,190)
WHITE = mat("White_print", (0.9, 0.9, 0.9), 0.0, 0.5)
UHMW = mat("UHMW", (0.85, 0.84, 0.78), 0.0, 0.6)
STRAP = mat("Strap", (0.01, 0.01, 0.01), 0.0, 0.9)
HOLE = mat("Hole", (0.003, 0.003, 0.003), 0.0, 0.8)
COLLAR = mat("Collar_dark", (0.03, 0.03, 0.03), 0.4, 0.4)         # sim: BGR (45,45,45)
YELLOW = mat("Marker_ball_yellow", (1.0, 0.68, 0.0), 0.0, 0.55)   # sim: BGR (0,215,255)
TAPE = mat("Marker_tape_yellow", (1.0, 0.68, 0.0), 0.0, 0.5)     # centre marking, yellow (sim had magenta)
LEVER = mat("Collar_black_anodized", (0.02, 0.02, 0.022), 0.6, 0.35)
CAP = mat("Sleeve_cap_black", (0.012, 0.012, 0.014), 0.0, 0.45)
IPF_BODY = mat("IPF_collar_steel", (0.55, 0.55, 0.57), 1.0, 0.35)
TPE = mat("IPF_collar_TPE", (0.01, 0.01, 0.01), 0.0, 0.8)
ZINC = mat("Zinc_bolt", (0.6, 0.6, 0.62), 1.0, 0.4)
RUBBER = mat("Rubber_floor", (0.03, 0.03, 0.032), 0.0, 0.6)
WALL = mat("Wall", (0.3, 0.3, 0.32), 0.0, 0.9)
PANEL = mat("Marker_panel", (0.9, 0.9, 0.9), 0.0, 0.6)

# ================= MONOLIFT (Legend 3908 proportions) =================
T = 0.1016           # 4x4 in tube
T3 = 0.0762          # 3x3 in tube for the top frame
UX = 0.978           # upright centre x -> 73 in (1.854 m) clear lifting width
H = 2.28             # upright height 89.75 in
TOP = 2.64           # total height incl. tilt lever, 103.75 in
RAIL = 2.03          # 80 in total length
FOOT_X = 1.21        # 95.25 in total width across the foot beams
BAR_Y, BAR_Z = -0.35, 1.30
HOOK_X = 0.371       # PRD: J-hooks at +-371 mm
FZ = 2.20            # top-frame centre height
RAILY = BAR_Y + 0.03
ML = empty("Monolift")
parts = []

for s in (-1, 1):
    # base: side rail runs to the spotter side (+Y), cross foot sticks out sideways, no rear crossmember
    parts.append(box("side_rail", (T, RAIL, T), (s * UX, -T / 2 + RAIL / 2, T / 2), BLACK))
    xa, xb = UX - 0.20, FOOT_X
    parts.append(box("cross_foot", (xb - xa, T, T), (s * (xa + xb) / 2, 0, T / 2), BLACK))
    parts.append(prism("gusset_rear", [(0.05, T), (0.75, T), (0.05, 0.85)], 0.012, s * UX, BLACK))
    parts.append(prism("gusset_out", [(s * (UX + T / 2), T), (s * 1.15, T), (s * (UX + T / 2), 0.75)],
                       0.012, 0, BLACK, plane='xz'))
    for bx, by in ((s * (FOOT_X - 0.05), 0), (s * UX, RAIL - T - 0.05)):  # levelling bolts
        parts.append(cyl("level_bolt", 0.012, 0.04, 'z', (bx, by, -0.012), CHROME, 0.001, 24))
    parts.append(box("upright", (T, T, H - T), (s * UX, 0, (H + T) / 2), BLACK))
    for n in range(25):  # 25 height settings
        parts.append(cyl("hole", 0.011, 0.004, 'y', (s * UX, -T / 2, 0.25 + n * 0.0635), HOLE, 0, 12))
    for z in (0.60, 1.10, 1.60):  # chrome plate-storage pegs welded through the upright
        parts.append(cyl("peg", 0.0254, 0.30, 'x', (s * (UX + T / 2 + 0.15), 0, z), CHROME))
    # top frame side rail cantilevers toward the lifter
    parts.append(box("frame_side", (T3, 0.80, T3), (s * UX, -0.40, FZ), BLACK))
    # hanging arm: two 3/8 in plates, stem behind the bar, cup under it, UHMW pad on the contact
    xh = s * HOOK_X
    parts.append(box("hook_carrier", (0.11, 0.20, 0.11), (xh, RAILY, FZ), BLACK))

def arc(cy, cz, r, a0, a1, n=8):
    return [(cy + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

# J-hook (Legend: 1.25x1.5 in tube between two 3/8 in laser-cut plates, UHMW pad, five 1/2 in bolts)
by, bz, RS = BAR_Y, BAR_Z, 0.0195
hook = ([(by + 0.15, FZ), (by + 0.15, bz - 0.12)]
        + arc(by + 0.10, bz - 0.12, 0.05, 0, -90)            # rounded back-bottom
        + arc(by - 0.02, bz - 0.09, 0.08, -90, -180)         # J curve under the bar
        + arc(by - 0.075, bz + 0.01, 0.025, 180, 90)         # lip top
        + arc(by, bz, RS, 195, 345, 10)                      # seat for the bar, lip ramps down into it
        + [(by + 0.03, bz + 0.01), (by + 0.03, FZ)])
pad = arc(by, bz, RS, 190, 350, 10) + arc(by, bz, 0.0148, 350, 190, 10)
PL_T, PL_X = 0.0095, 0.0235                                  # 3/8 in plates, 1.5 in (38 mm) apart
for s in (-1, 1):
    xh = s * HOOK_X
    for d in (-1, 1):
        parts.append(prism("hook_plate", hook, PL_T, xh + d * PL_X, BLACK, 0.002))
        for a in (200, 235, 270, 305, 340):                  # five pad bolts per plate
            parts.append(cyl("hook_bolt", 0.0085, 0.005, 'x', (xh + d * (PL_X + PL_T / 2 + 0.0025),
                             by + 0.045 * math.cos(math.radians(a)), bz + 0.045 * math.sin(math.radians(a))),
                             ZINC, 0.0005, 6))
    parts.append(prism("hook_pad", pad, 2 * PL_X - PL_T, xh, UHMW, 0))
    parts.append(box("hook_tube", (2 * PL_X - PL_T, 0.032, 0.038), (xh, by - 0.03, bz - 0.13), BLACK))
    parts.append(cyl("hook_rod", 0.0127, 2 * (PL_X + PL_T), 'x', (xh, by + 0.10, bz + 0.08), CHROME, 0.001, 24))
    parts.append(cyl("bearing_block", 0.03, 0.06, 'x', (xh, RAILY, FZ + T3 / 2 + 0.03), CHROME, 0.001, 24))

# top frame: back rail on the uprights, front rail, hanger rail with chrome guide rod
parts.append(box("frame_back", (2 * UX - T, T3, T3), (0, 0, FZ), BLACK))
parts.append(box("frame_front", (2 * UX, T3, T3), (0, -0.80, FZ), BLACK))
parts.append(box("frame_hanger_rail", (2 * UX - T, T3, T3), (0, RAILY, FZ), BLACK))
parts.append(cyl("guide_rod", 0.0127, 2 * UX - T, 'x', (0, RAILY, FZ + T3 / 2 + 0.0127), CHROME, 0.0005, 24))
# tilt lever on one upright
parts.append(prism("tilt_lever", [(0.0, 2.20), (0.075, 2.20), (0.55, TOP), (0.43, TOP)], T3, UX, BLACK))

# ArUco id 0 (DICT_4X4_50) hanging in the bar plane, centre 140 mm above the bar axis
bits = ["1011", "0101", "0011", "0010"]   # OpenCV bytesList[0] = 181, 50; row-major, 1 = white
grid = [[0] * 6 for _ in range(6)]
for r_ in range(4):
    for c_ in range(4):
        grid[r_ + 1][c_ + 1] = int(bits[r_][c_])
img = bpy.data.images.new("aruco_id0", 6, 6)
img.pixels = [v for row in reversed(grid) for g in row for v in (g, g, g, 1.0)]
img.pack()
ARUCO = mat("ArUco_id0", (1, 1, 1), 0.0, 0.7)
tx = ARUCO.node_tree.nodes.new('ShaderNodeTexImage')
tx.image, tx.interpolation = img, 'Closest'
ARUCO.node_tree.links.new(tx.outputs['Color'], ARUCO.node_tree.nodes["Principled BSDF"].inputs['Base Color'])
MZ = BAR_Z + 0.14

# backing board between bar and rack: millimetre paper (0 at bar axis / rack centre) + ArUco, on two floor posts.
# shortcut: board stands 0.23 m behind the bar plane (PRD risk "Tiefenversatz"), measure it before real use.
BW, BH, BZ0 = 2.60, 1.00, 0.80           # backdrop: covers the whole bar incl. balls from the front
BY = BAR_Y + 0.236                      # front face at -0.12 m: just behind the plate stacks (rear edge -0.125)
BT = 0.012
BZC = BZ0 + BH / 2
PAPER = bpy.data.materials.new("Millimetre_paper")
PAPER.use_nodes = True
pn, pl = PAPER.node_tree.nodes, PAPER.node_tree.links
bsdf = pn["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.8

def mnode(op, a=None, b=None):
    n = pn.new('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        elif v is not None:
            pl.new(v, n.inputs[i])
    return n.outputs[0]

def line_mask(coord, period, width):
    """1.0 within width/2 of a multiple of period, else 0."""
    t = mnode('FRACT', mnode('ADD', mnode('MULTIPLY', coord, 1.0 / period), 0.5))
    d = mnode('MULTIPLY', mnode('ABSOLUTE', mnode('SUBTRACT', t, 0.5)), period)
    return mnode('LESS_THAN', d, width / 2)

tcoord = pn.new('ShaderNodeTexCoord')
sep = pn.new('ShaderNodeSeparateXYZ')
pl.new(tcoord.outputs['Object'], sep.inputs[0])
px_ = sep.outputs[0]                                         # across the rack, 0 = centre
pz_ = mnode('ADD', sep.outputs[1], BZC - BAR_Z)              # plane-local y -> height above the bar axis

def mix(col_in, mask, rgba):
    m = pn.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.inputs[7].default_value = rgba
    pl.new(mask, m.inputs[0])
    if isinstance(col_in, tuple):
        m.inputs[6].default_value = col_in
    else:
        pl.new(col_in, m.inputs[6])
    return m.outputs[2]

col = (0.97, 0.96, 0.92, 1)                                  # paper
for period, width, rgba in ((0.001, 0.00012, (0.95, 0.72, 0.55, 1)),
                            (0.005, 0.0002, (0.9, 0.5, 0.3, 1)),
                            (0.01, 0.00035, (0.8, 0.28, 0.12, 1))):
    for c in (px_, pz_):
        col = mix(col, line_mask(c, period, width), rgba)
col = mix(col, mnode('LESS_THAN', mnode('ABSOLUTE', px_), 0.0006), (0.02, 0.02, 0.02, 1))   # centre line x = 0
col = mix(col, mnode('LESS_THAN', mnode('ABSOLUTE', pz_), 0.0006), (0.02, 0.02, 0.02, 1))   # bar axis z = 0
pl.new(col, bsdf.inputs["Base Color"])

bm = bmesh.new()
bm.faces.new([bm.verts.new((sx * BW / 2, sz * BH / 2, 0)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
paper = finish("millimetre_paper", bm, PAPER, (0, BY - BT / 2 - 0.0005, BZC), 0)
paper.rotation_euler = (math.pi / 2, 0, 0)                   # faces the lifter (-Y)
parts.append(paper)
parts.append(box("board", (BW, BT, BH), (0, BY, BZC), BLACK, 0.002))
for s in (-1, 1):
    parts.append(box("board_post", (0.03, 0.03, BZ0 + BH), (s * (BW / 2 - 0.02), BY + BT / 2 + 0.015, (BZ0 + BH) / 2), BLACK))
parts.append(box("marker_panel", (0.12, 0.001, 0.12), (0, BY - BT / 2 - 0.001, MZ), PANEL, 0))
bpy.ops.mesh.primitive_plane_add(size=0.10, location=(0, BY - BT / 2 - 0.0016, MZ), rotation=(math.pi / 2, 0, 0))
mk = bpy.context.object
mk.name = "aruco_marker"
mk.data.materials.append(ARUCO)
parts.append(mk)
parent(parts, ML)

# ================= ELEIKO POWERBAR + 225 kg =================
BL = empty("Barbell_225kg")
BL.location = (0, BAR_Y, BAR_Z)
bar = []
SHAFT_HALF, HALF = 0.655, 1.10        # shaft 1310 mm, total 2200 mm
bar.append(cyl("shaft", 0.0145, 2 * SHAFT_HALF, 'x', BL.location, SHAFT, 0.0003))
for a, b in ((-0.57, -0.41), (-0.40, 0.40), (0.41, 0.57)):   # knurl, smooth ring marks at +-405 mm
    bar.append(cyl("knurl", 0.0146, b - a, 'x', ((a + b) / 2, BAR_Y, BAR_Z), KNURL, 0, 64))
bar.append(cyl("marker_tape", 0.0152, 0.04, 'x', (0, BAR_Y, BAR_Z), TAPE, 0, 48))   # 40 mm magenta tape

# Eleiko IPF 25 kg: 450 mm, 27 mm thick (eleiko.com), recessed face between rim and hub
PT, PR, N = 0.027, 0.225, 4
BALL_R, CL = 0.035, 0.093      # 70 mm marker ball (was 50), IPF collar length
h = PT / 2
plate_prof = [(-(h - 0.003), 0.075), (-(h - 0.003), 0.20), (-h, 0.20), (-h, PR), (h, PR), (h, 0.20),
              (h - 0.003, 0.20), (h - 0.003, 0.075)]
hub_prof = [(-h - 0.0003, 0.0255), (-h - 0.0003, 0.075), (h + 0.0003, 0.075), (h + 0.0003, 0.0255)]
X0 = SHAFT_HALF + 0.005               # stack starts 5 mm behind the sleeve shoulder (simulate.py)
for s in (-1, 1):
    ln = HALF - SHAFT_HALF
    bar.append(cyl("sleeve", 0.025, ln, 'x', (s * (SHAFT_HALF + ln / 2), BAR_Y, BAR_Z), STEEL, 0.002))
    # bell-shaped cap over the sleeve end with a yellow ball on a short neck (like the printed prototype)
    CR = 0.033
    bell = [(HALF - 0.035, 0.0001), (HALF - 0.035, CR), (HALF + 0.002, CR)] + \
           [(HALF + 0.002 + CR * math.sin(math.radians(a)), CR * math.cos(math.radians(a)))
            for a in range(10, 91, 10)]
    bar.append(lathe("sleeve_cap", [(s * x, r) for x, r in bell], CAP, (0, BAR_Y, BAR_Z), 0, 64))
    x_tip = HALF + 0.002 + CR
    bar.append(sphere("marker_ball", BALL_R, (s * (x_tip + BALL_R - 0.002), BAR_Y, BAR_Z), YELLOW))   # touches the cap
    for i in range(N):
        xc = s * (X0 + PT * (i + 0.5))
        bar.append(lathe("plate_25kg", plate_prof, RED, (xc, BAR_Y, BAR_Z), 0.0012))
        bar.append(lathe("plate_hub", hub_prof, CHROME, (xc, BAR_Y, BAR_Z), 0.0005, 64))
    xo = s * (X0 + PT * (N - 0.5)) + s * (h - 0.003 + 0.0003)    # recessed outer face of the last plate
    bar.append(text("25", 0.075, (xo, BAR_Y, BAR_Z + 0.135), s, WHITE))
    bar.append(text("ELEIKO", 0.03, (xo, BAR_Y, BAR_Z - 0.135), s, WHITE))
    # IPF competition collar, 2.5 kg: 93 mm along the sleeve, 110 mm dia, TPE ring on the plate side,
    # knurled wheel outside, locking lever on top (Eleiko lists IPF collars as 33 mm wider than its 60 mm one)
    xc = s * (X0 + PT * N + CL / 2)
    c0 = (xc, BAR_Y, BAR_Z)
    hl = CL / 2
    body = [(-hl, 0.0255), (-hl, 0.050), (-hl + 0.006, 0.055), (hl - 0.006, 0.055), (hl, 0.050), (hl, 0.0255)]
    ring = [(-hl - 0.004, 0.032), (-hl - 0.004, 0.050), (-hl, 0.050), (-hl, 0.032)]
    bar.append(lathe("ipf_collar_body", [(s * x, r) for x, r in body], IPF_BODY, c0, 0.001, 64))
    bar.append(lathe("ipf_collar_tpe", [(s * x, r) for x, r in ring], TPE, c0, 0, 64))
    bar.append(cyl("ipf_collar_wheel", 0.034, 0.014, 'x', (xc + s * (hl + 0.005), BAR_Y, BAR_Z), LEVER, 0.001, 36))
    lv = box("ipf_collar_lever", (0.026, 0.014, 0.085), (xc, BAR_Y, BAR_Z + 0.085), LEVER, 0.003)
    lv.rotation_euler = (math.radians(-20), 0, 0)
    bar.append(lv)
    bar.append(cyl("ipf_collar_pin", 0.008, 0.034, 'x', (xc, BAR_Y, BAR_Z + 0.056), ZINC, 0.0005, 16))
parent(bar, BL)

# load protocol from simulate.plates_for_load: load = 25 + 50 n  (n plates per side, collars included)
mass = 20 + 2 * (N * 25) + 2 * 2.5
assert mass == 225 == 25 + 50 * N, mass
assert X0 + PT * N + CL < UX - T / 2, "stack would hit the uprights"
assert X0 + PT * N + CL < HALF, "collar would not fit on the sleeve"
assert HOOK_X + 0.03 < X0, "hooks would hit the plates"
print("TOTAL LOAD KG:", mass)

# ================= SCENE =================
bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0))
bpy.context.object.data.materials.append(RUBBER)
bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 4.0, 4), rotation=(math.pi / 2, 0, 0))
bpy.context.object.data.materials.append(WALL)

tgt = empty("look_at")
tgt.location = (0, 0.3, 1.15)

def aim(ob):
    c = ob.constraints.new('TRACK_TO')
    c.target = tgt
    c.track_axis, c.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'

def light(name, loc, energy, size):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy, ld.size = energy, size
    ob = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(ob)
    ob.location = loc
    aim(ob)

light("key", (3.5, -4.5, 4.2), 1300, 3.0)
light("fill", (-4.5, -3.5, 2.4), 450, 3.0)
light("rim", (0, 3.0, 3.6), 600, 3.0)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.06, 0.07, 1)
scene.world = w

def camera(name, loc, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    ob = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(ob)
    ob.location = loc
    aim(ob)
    return ob

scan_d = bpy.data.cameras.new("cam_scan")        # Barbellscan view: straight-on, 1 px = 1 mm
scan_d.type, scan_d.ortho_scale = 'ORTHO', 2.52
scan = bpy.data.objects.new("cam_scan", scan_d)
scene.collection.objects.link(scan)
scan.location, scan.rotation_euler = (0, -5.0, BAR_Z), (math.pi / 2, 0, 0)

cams = {"iso": (camera("cam_iso", (-4.6, -5.4, 2.4), 36), (1600, 900)),
        "front": (camera("cam_front", (0.0, -7.0, 1.5), 38), (1600, 900)),
        "bar": (camera("cam_bar", (1.5, -1.9, 1.5), 45), (1600, 900)),
        "scan": (scan, (2520, 600))}

scene.view_settings.view_transform = 'Standard'    # keeps the yellow markers saturated
scene.view_settings.exposure = -0.8
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "monolift.blend"))
if os.environ.get("RENDER", "1") == "1":
    for k, (cam, res) in cams.items():
        scene.camera = cam
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = os.path.join(OUT, f"render_{k}.png")
        bpy.ops.render.render(write_still=True)
scene.camera = cams["iso"][0]
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "monolift.blend"))
