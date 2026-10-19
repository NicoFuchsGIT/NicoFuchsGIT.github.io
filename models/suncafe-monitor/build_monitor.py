"""Desktop monitor showing the SunCafe web app, for embedding in a 3D CV (glTF/GLB).

blender -b -P build_monitor.py
Writes suncafe_monitor.blend, suncafe_monitor.glb and render_monitor.png next to this script.

Conventions: metres, feet on z=0, screen faces -Y in Blender (= +Z after glTF export).
Mesh "Screen" has UVs 0..1 (upright, not mirrored): swap screen_suncafe.jpg or drive it with a
CanvasTexture / VideoTexture / CSS3D iframe at runtime.
"""
import math, os
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
SW, SH = 0.597, 0.336            # 27" 16:9 active area
SIDE, TOP, CHIN = 0.008, 0.008, 0.020
BODY_T = 0.014
FOOT_Z = 0.0
NECK_H = 0.17
SCREEN_Z0 = 0.11 + CHIN          # bottom edge of active area above table
CZ = SCREEN_Z0 + SH / 2          # centre of screen

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def mat(name, color, rough=0.4, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def box(name, size, loc, m, bevel=0.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    if bevel:
        bv = o.modifiers.new("bevel", 'BEVEL')
        bv.width, bv.segments = bevel, 3
    bpy.ops.object.shade_smooth()
    return o


SHELL = mat("Monitor_shell", (0.02, 0.02, 0.022), 0.35)
ALU = mat("Stand_aluminium", (0.55, 0.56, 0.58), 0.35, 1.0)
LED = mat("Power_LED", (0.2, 0.9, 0.3), 0.3)
LED.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (0.2, 0.9, 0.3, 1)
LED.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.0

# front body (bezel): active area + frame; centre of body in x=0, y=0
body_w, body_h = SW + 2 * SIDE, SH + TOP + CHIN
body_zc = SCREEN_Z0 - CHIN + body_h / 2
box("Monitor_body", (body_w, BODY_T, body_h), (0, 0, body_zc), SHELL, 0.003)
# tapered back shell
box("Monitor_back", (body_w * 0.72, 0.022, body_h * 0.62), (0, BODY_T / 2 + 0.011 - 0.002, body_zc + 0.01), SHELL, 0.008)
# stand
box("Stand_neck", (0.07, 0.016, NECK_H), (0, BODY_T / 2 + 0.03, FOOT_Z + 0.012 + NECK_H / 2), ALU, 0.003)
box("Stand_foot", (0.26, 0.20, 0.012), (0, BODY_T / 2 + 0.03 - 0.02, FOOT_Z + 0.006), ALU, 0.005)
box("Stand_hinge", (0.09, 0.03, 0.05), (0, BODY_T / 2 + 0.02, SCREEN_Z0 + 0.03), ALU, 0.006)

# power LED in the chin
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0012, location=(SW / 2 - 0.02, -BODY_T / 2 - 0.0002, SCREEN_Z0 - CHIN / 2))
led = bpy.context.object
led.name = "Power_LED"
led.scale = (1, 0.4, 1)
led.data.materials.append(LED)

# screen: plane facing -Y, UV 0..1
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -BODY_T / 2 - 0.0002, CZ), rotation=(math.pi / 2, 0, 0))
scr = bpy.context.object
scr.name = "Screen"
scr.scale = (SW, SH, 1)
bpy.ops.object.transform_apply(scale=True)
m = bpy.data.materials.new("Screen_SunCafe")
m.use_nodes = True
nt = m.node_tree
b = nt.nodes["Principled BSDF"]
img = nt.nodes.new("ShaderNodeTexImage")
img.image = bpy.data.images.load(os.path.join(HERE, "screen_suncafe.jpg"))
img.image.pack()
img.interpolation = 'Linear'
b.inputs["Base Color"].default_value = (0, 0, 0, 1)
b.inputs["Roughness"].default_value = 0.25
b.inputs["Emission Strength"].default_value = 1.0
nt.links.new(img.outputs["Color"], b.inputs["Emission Color"])
scr.data.materials.append(m)

# ---- preview render ----
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1400, 900
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.92, 0.95, 1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
sc.world = w

bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, -0.0005))
fl = bpy.context.object
fl.name = "preview_floor"
fl.data.materials.append(mat("Desk", (0.55, 0.42, 0.3), 0.6))

bpy.ops.object.light_add(type='AREA', location=(-0.8, -1.2, 1.0))
L = bpy.context.object
L.data.energy, L.data.size = 120, 1.0
L.rotation_euler = (math.radians(70), 0, math.radians(-30))

bpy.ops.object.camera_add(location=(0.9, -1.35, 0.55))
cam = bpy.context.object
cam.data.lens = 55
tgt = bpy.data.objects.new("tgt", None); tgt.location = (0, 0, CZ - 0.02); sc.collection.objects.link(tgt)
tc = cam.constraints.new('TRACK_TO'); tc.target = tgt; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
sc.view_settings.exposure = -0.4
sc.camera = cam
sc.render.filepath = os.path.join(HERE, "render_monitor.png")

# export without preview-only objects
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "suncafe_monitor.blend"))
bpy.ops.render.render(write_still=True)
for n in ("preview_floor",):
    bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
for o in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA', 'EMPTY')]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, "suncafe_monitor.glb"), export_format='GLB',
                          export_apply=True, export_yup=True)
print("DONE", [o.name for o in bpy.data.objects])
