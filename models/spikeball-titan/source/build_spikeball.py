"""Spikeball TITAN Set - procedurales Modell.
Ausfuehren: blender -b -P models/spikeball-titan/source/build_spikeball.py

Titan-spezifisch (gegenueber dem Standard-Set):
- hoher, flacher Rahmen mit dreieckigem Profil statt rundem Rohr
- Netz aus geknoteter Schnur (Rauten), laeuft ueber die Oberkante, aussen am Band
  herunter und wird unter der Rahmenunterkante an vielen Haken eingehaengt
- schwarze Verbindermuffen mit TITAN-Schriftzug
- kurze, breite Dreiecks-Blockbeine (einrastend) statt Rohrbeinen
- 1x Pro-Ball + 1x Atlas-Ball (18 % groesser, gelb/schwarz)
Masse sind angenaehert (Regulation: ca. 91 cm Netzdurchmesser)."""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# --- Szene leeren -----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- Abmessungen (Meter) ----------------------------------------------------
RIN = 0.455       # Innenkante Rahmen = Netzradius
RW = 0.030        # Rahmenbreite (radial, oben)
RH = 0.085        # Rahmenhoehe (Band)
ZT = 0.215        # Rahmenoberkante ueber Boden
ZB = ZT - RH      # Rahmenunterkante
LEGS = 5
SAG = 0.02        # Durchhang Netzmitte
SLEEVE = 0.004    # Wandstaerke Verbindermuffe
NET_OFF = SLEEVE + 0.003
DROP = RH + 2 * NET_OFF   # Netz laeuft aussen bis unter die Unterkante
UNDER = 0.012     # Stueck, das unter dem Band nach innen umgeschlagen ist
MESH = 0.030      # Maschenweite (Diagonale der Raute)
CORD_R = 0.0016   # Schnurradius
KNOT_R = 0.0034   # Knotenradius
HOOKS = 72
PRO_R = 0.0445
ATLAS_R = PRO_R * 1.18

# Rahmenprofil (radial ab RIN, z ab ZT): dreieckig, aussen senkrecht, innen schraeg
PROFILE = [(0.0, 0.0), (RW, 0.0), (RW, -RH), (RW * 0.62, -RH)]

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

YELLOW = mat("Titan_Gelb", (1.0, 0.78, 0.0), 0.4)
BLACK = mat("Schwarz_Kunststoff", (0.015, 0.015, 0.015), 0.45)
NET = mat("Netz", (0.01, 0.01, 0.01), 0.7)
PRO = mat("Pro_Ball", (1.0, 0.78, 0.02), 0.55)
RUBBER = mat("Gummi", (0.03, 0.03, 0.03), 0.9)
GRASS = mat("Rasen", (0.06, 0.2, 0.04), 1.0)

def atlas_material():
    """Gelber Ball mit zwei schwarzen Ringen (Atlas-Logo angedeutet)."""
    m = bpy.data.materials.new("Atlas_Ball")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.55
    tc = nt.nodes.new("ShaderNodeTexCoord")
    norm = nt.nodes.new("ShaderNodeVectorMath"); norm.operation = 'NORMALIZE'
    dot = nt.nodes.new("ShaderNodeVectorMath"); dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = Vector((0.3, -0.5, 0.81)).normalized()
    ab = nt.nodes.new("ShaderNodeMath"); ab.operation = 'ABSOLUTE'
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp; cr.interpolation = 'CONSTANT'
    cr.elements[0].position = 0.0; cr.elements[0].color = (1.0, 0.78, 0.02, 1)
    cr.elements[1].position = 0.55; cr.elements[1].color = (0.01, 0.01, 0.01, 1)
    e = cr.elements.new(0.84); e.color = (1.0, 0.78, 0.02, 1)
    nt.links.new(tc.outputs["Object"], norm.inputs[0])
    nt.links.new(norm.outputs["Vector"], dot.inputs[0])
    nt.links.new(dot.outputs["Value"], ab.inputs[0])
    nt.links.new(ab.outputs["Value"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    m.diffuse_color = (1.0, 0.78, 0.02, 1)
    return m

ATLAS = atlas_material()

col = bpy.data.collections.new("Spikeball_Titan_Set")
scene.collection.children.link(col)

def to_col(o):
    for c in o.users_collection:
        c.objects.unlink(o)
    col.objects.link(o)

def mesh_obj(name, bm, m):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.data.materials.append(m)
    return o

def smooth_by_angle(o, deg=35):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(deg))
    o.select_set(False)

def bevel(o, w, seg=3):
    b = o.modifiers.new("Bevel", 'BEVEL')
    b.width = w; b.segments = seg
    b.limit_method = 'ANGLE'; b.angle_limit = math.radians(30)
    return b

def revolve(name, profile, offset, a0, a1, segs, m, cap=True):
    """Profil (dr, dz) um Z drehen; offset vergroessert das Profil nach aussen."""
    cx = sum(p[0] for p in profile) / len(profile)
    cz = sum(p[1] for p in profile) / len(profile)
    prof = []
    for dr, dz in profile:
        d = Vector((dr - cx, dz - cz))
        d = d + d.normalized() * offset * 1.4
        prof.append((cx + d.x, cz + d.y))
    full = abs((a1 - a0) - 2 * math.pi) < 1e-6
    bm = bmesh.new()
    rings = []
    n = segs if full else segs + 1
    for i in range(n):
        a = a0 + (a1 - a0) * i / segs
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new(((RIN + dr) * c, (RIN + dr) * s, ZT + dz)) for dr, dz in prof])
    k = len(prof)
    for i in range(n - 1 + (1 if full else 0)):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(k):
            bm.faces.new((r0[j], r0[(j + 1) % k], r1[(j + 1) % k], r1[j]))
    if not full and cap:
        bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, m)

def curved_text(body, angle, radius, zmid, size, m, name):
    """Text, der aussen am Rahmenband entlang gebogen ist (Curve-Modifier)."""
    cd = bpy.data.curves.new(name + "_Pfad", 'CURVE'); cd.dimensions = '3D'
    sp = cd.splines.new('POLY'); N = 256
    sp.points.add(N - 1)
    for i, pt in enumerate(sp.points):
        a = 2 * math.pi * i / N
        pt.co = (radius * math.cos(a), radius * math.sin(a), 0, 1)
    sp.use_cyclic_u = True
    path = bpy.data.objects.new(name + "_Pfad", cd)
    path.location = (0, 0, zmid)
    col.objects.link(path); path.hide_render = True; path.hide_viewport = True
    td = bpy.data.curves.new(name, 'FONT')
    td.body = body; td.align_x = 'CENTER'; td.align_y = 'CENTER'
    td.size = size; td.extrude = 0.0006
    td.materials.append(m)
    t = bpy.data.objects.new(name, td)
    col.objects.link(t)
    t.location = (radius * angle, 0, zmid)
    t.rotation_euler = (math.pi / 2, 0, 0)
    cm = t.modifiers.new("Biegen", 'CURVE'); cm.object = path; cm.deform_axis = 'POS_X'
    return t

leg_angles = [i * 2 * math.pi / LEGS - math.pi / 2 + 0.35 for i in range(LEGS)]

# --- Rahmen (gelbes Band mit Dreiecksprofil) --------------------------------
rim = revolve("Rahmen", PROFILE, 0.0, 0, 2 * math.pi, 240, YELLOW)
bevel(rim, 0.004); smooth_by_angle(rim)

# --- Verbindermuffen + Blockbeine ------------------------------------------
SLEEVE_ARC = 0.15 / RIN
LX0, LX1 = RIN - 0.03, RIN + 0.065    # Beinfuss radial (innen/aussen)
TX0, TX1 = RIN + 0.004, RIN + RW      # Beinkopf radial
BY, TY = 0.068, 0.055                 # halbe Breite unten / oben

def leg_block():
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [
        (LX0, -BY, 0), (LX1, -BY, 0), (LX1, BY, 0), (LX0, BY, 0),
        (TX0, -TY, ZB), (TX1, -TY, ZB), (TX1, TY, ZB), (TX0, TY, ZB)]]
    for f in [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def window_cutter():
    """Dreiecksfenster, quer (tangential) durch den Beinblock."""
    bm = bmesh.new()
    tri = [(RIN - 0.017, 0.022), (RIN + 0.045, 0.022), (RIN + 0.010, ZB - 0.025)]
    front = [bm.verts.new((x, -0.2, z)) for x, z in tri]
    back = [bm.verts.new((x, 0.2, z)) for x, z in tri]
    bm.faces.new(front); bm.faces.new(back[::-1])
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Fenster"); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("Fenster_Cutter", me)
    col.objects.link(o); o.hide_render = True; o.hide_viewport = True
    return o

cutter = window_cutter()
outer_slope = math.atan2(LX1 - TX1, ZB)   # Neigung der Beinaussenseite

for i, a in enumerate(leg_angles):
    deg = math.degrees(a)
    # Muffe um das Band
    sl = revolve(f"Verbinder_{i+1}", PROFILE, SLEEVE, a - SLEEVE_ARC / 2, a + SLEEVE_ARC / 2, 24, BLACK)
    bevel(sl, 0.003); smooth_by_angle(sl)
    # Blockbein (einrastend), Dreiecksfenster seitlich
    leg = mesh_obj(f"Bein_{i+1}", leg_block(), BLACK)
    leg.rotation_euler = (0, 0, a)
    bo = leg.modifiers.new("Fenster", 'BOOLEAN'); bo.object = cutter; bo.operation = 'DIFFERENCE'
    bo.solver = 'EXACT'
    bevel(leg, 0.004)
    smooth_by_angle(leg)
    # Gummisohle
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((LX1 - LX0 + 0.004, 2 * BY + 0.004, 0.008, 1)))
    bmesh.ops.translate(bm, verts=bm.verts, vec=((LX0 + LX1) / 2, 0, 0.004))
    sole = mesh_obj(f"Sohle_{i+1}", bm, RUBBER); sole.rotation_euler = (0, 0, a)
    bevel(sole, 0.002)
    # Logo-Plakette auf der Beinaussenseite
    ez = ZB * 0.5
    er = LX1 - (LX1 - TX1) * (ez / ZB) + 0.0015
    c, s = math.cos(a), math.sin(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.025, depth=0.002,
                                        location=(er * c, er * s, ez))
    em = bpy.context.active_object; em.name = f"Logo_{i+1}"
    em.rotation_euler = (0, math.pi / 2 - outer_slope, 0)
    em.rotation_euler.rotate(Matrix.Rotation(a, 3, 'Z').to_euler())
    em.data.materials.append(YELLOW); to_col(em)
    bpy.ops.object.text_add(location=((er + 0.0012) * c, (er + 0.0012) * s, ez))
    t = bpy.context.active_object; t.name = f"Logo_{i+1}_S"
    t.data.body = "S"; t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
    t.data.size = 0.042; t.data.extrude = 0.0004
    t.rotation_euler = (math.pi / 2 - outer_slope, 0, a + math.pi / 2)
    t.data.materials.append(BLACK); to_col(t)
    # TITAN-Schriftzug auf der Muffe
    curved_text("TITAN", a % (2 * math.pi), RIN + RW + SLEEVE * 1.4 + 0.0008,
                ZT - RH * 0.45, 0.026, YELLOW, f"Titan_Schrift_{i+1}")
    # "Spikeball" auf dem gelben Band zwischen zwei Beinen
    mid = (a + math.pi / LEGS) % (2 * math.pi)
    curved_text("Spikeball", mid, RIN + RW + 0.0008, ZT - RH * 0.6, 0.046, BLACK, f"Band_Schrift_{i+1}")

# --- Netz (ueber die Oberkante gezogen, aussen eingehaengt) ----------------
NTOP = ZT + NET_OFF
NOUT = RIN + RW + NET_OFF
WTOP = NOUT - RIN

ZH = ZB - NET_OFF                 # Hoehe des umgeschlagenen Netzrands unter dem Band
S_DROP = WTOP + DROP              # Ende der Aussenseite (planarer Abstand ab RIN)
SPAN = RIN + S_DROP + UNDER       # planarer Gesamtradius des Netzes

def net_map(rho):
    """planarer Abstand -> (radius, z): Spielflaeche / ueber Oberkante / aussen runter / unter das Band."""
    if rho <= RIN:
        return rho, NTOP - SAG * (1 - (rho / RIN) ** 2)
    s = rho - RIN
    if s <= WTOP:
        return RIN + s, NTOP
    if s <= S_DROP:
        return NOUT, NTOP - (s - WTOP)
    return NOUT - (s - S_DROP), ZH

def net_point(x, y):
    rho = math.hypot(x, y)
    r, z = net_map(rho)
    f = r / rho if rho > 1e-9 else 0.0
    return Vector((x * f, y * f, z))

def ang_dist(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)

def hidden(x, y):
    """Umgeschlagener Teil, der in einem Beinkopf stecken wuerde."""
    if math.hypot(x, y) < RIN + S_DROP - 0.002:
        return False
    a = math.atan2(y, x)
    return min(ang_dist(a, la) for la in leg_angles) * RIN < TY + 0.004

# Schnuere: zwei Scharen diagonaler Linien (ergibt Rautenmaschen)
cd = bpy.data.curves.new("Netz", 'CURVE'); cd.dimensions = '3D'
cd.bevel_depth = CORD_R; cd.bevel_resolution = 2
cd.materials.append(NET)
STEP = 0.004
d1 = Vector((1, 1)).normalized()      # Richtung entlang der Schnur
d2 = Vector((1, -1)).normalized()     # Versatz zwischen den Schnueren
n_lines = int(SPAN / MESH)
for dirv, offv in ((d1, d2), (d2, d1)):
    for i in range(-n_lines, n_lines + 1):
        c = i * MESH
        if abs(c) >= SPAN:
            continue
        half = math.sqrt(SPAN ** 2 - c ** 2)
        n = max(2, int(math.ceil(2 * half / STEP)))
        run = []
        def flush():
            if len(run) >= 2:
                sp = cd.splines.new('POLY'); sp.points.add(len(run) - 1)
                for pt, p in zip(sp.points, run):
                    pt.co = (*p, 1)
            run.clear()
        for k in range(n + 1):
            t = -half + 2 * half * k / n
            q = offv * c + dirv * t
            if hidden(q.x, q.y):
                flush()
            else:
                run.append(net_point(q.x, q.y))
        flush()
net = bpy.data.objects.new("Netz", cd)
col.objects.link(net)

# Knoten an allen Kreuzungen (leicht abgeflacht)
bm = bmesh.new()
for i in range(-n_lines, n_lines + 1):
    for j in range(-n_lines, n_lines + 1):
        q = d2 * (i * MESH) + d1 * (j * MESH)
        if q.length > SPAN - 0.003 or hidden(q.x, q.y):
            continue
        p = net_point(q.x, q.y)
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=KNOT_R,
                                   matrix=Matrix.Translation(p) @ Matrix.Diagonal((1, 1, 0.75, 1)))
knots = mesh_obj("Netz_Knoten", bm, NET)
for poly in knots.data.polygons:
    poly.use_smooth = True

# Saumkordel am umgeschlagenen Netzrand unter dem Band
ZH_R = NOUT - UNDER
bpy.ops.mesh.primitive_torus_add(major_radius=ZH_R, minor_radius=0.0035,
                                 major_segments=240, minor_segments=10, location=(0, 0, ZH))
hem = bpy.context.active_object; hem.name = "Netzsaum"
hem.data.materials.append(NET); to_col(hem)

# Haken unter der Rahmenunterkante: Lasche am Band + Haken um den Saum
bm = bmesh.new()
for k in range(HOOKS):
    a = 2 * math.pi * k / HOOKS
    if min(ang_dist(a, la) for la in leg_angles) < SLEEVE_ARC / 2 + 0.01:
        continue
    rot = Matrix.Rotation(a, 4, 'Z')
    bmesh.ops.create_cube(bm, size=1.0, matrix=rot @ Matrix.Translation((ZH_R, 0, (ZB + ZH) / 2))
                          @ Matrix.Diagonal((0.006, 0.009, ZB - ZH + 0.004, 1)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=rot @ Matrix.Translation((ZH_R - 0.003, 0, ZH - 0.004))
                          @ Matrix.Diagonal((0.010, 0.009, 0.003, 1)))
hooks = mesh_obj("Haken", bm, BLACK); bevel(hooks, 0.0012, 2)

# --- Baelle -----------------------------------------------------------------
def ball(name, r, loc, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=64, ring_count=32, location=loc)
    b = bpy.context.active_object; b.name = name; b.rotation_euler = rot
    b.data.materials.append(m)
    for p in b.data.polygons:
        p.use_smooth = True
    to_col(b)
    return b

ax, ay = 0.10, -0.06
ball("Atlas_Ball", ATLAS_R, (ax, ay, net_map(math.hypot(ax, ay))[1] + ATLAS_R + 0.002), ATLAS,
     rot=(0.4, 0.2, 0.9))
ball("Pro_Ball", PRO_R, (0.88, -0.30, PRO_R), PRO)

# --- Boden, Licht, Kamera ---------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
g = bpy.context.active_object; g.name = "Boden"; g.data.materials.append(GRASS)

bpy.ops.object.light_add(type='SUN', location=(2, -2, 4))
sun = bpy.context.active_object; sun.data.energy = 4.0; sun.data.angle = math.radians(4)
sun.rotation_euler = (math.radians(45), 0, math.radians(35))

world = bpy.data.worlds.new("Welt"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.7, 0.95, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6

bpy.ops.object.empty_add(location=(-0.1, 0.05, 0.08))
target = bpy.context.active_object; target.name = "Kameraziel"
bpy.ops.object.camera_add(location=(1.75, -2.0, 1.05))
cam = bpy.context.active_object; cam.data.lens = 40
tc = cam.constraints.new('TRACK_TO'); tc.target = target
scene.camera = cam

# --- Render / Speichern -----------------------------------------------------
scene.render.engine = 'CYCLES'
scene.cycles.samples = int(os.environ.get("SB_SAMPLES", 96))
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
looks = [i.identifier for i in scene.view_settings.bl_rna.properties['look'].enum_items]
scene.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in looks else 'None'

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "spikeball_titan.blend"))
scene.render.filepath = os.path.join(OUT_DIR, "review", "render_preview.png")
bpy.ops.render.render(write_still=True)
print("FERTIG")
