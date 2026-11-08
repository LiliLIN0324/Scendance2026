"""通用 GLB 渲染：给证据留影。用法 blender --background --python render_glb.py -- <glb> <outdir> <prefix>"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUTDIR, PREFIX = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
os.makedirs(OUTDIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    raise SystemExit("no mesh")
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        mn = Vector((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
        mx = Vector((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
H = mx.z - mn.z
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 24
sc.render.resolution_x = 800
sc.render.resolution_y = 800
w = bpy.data.worlds.new("W")
sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.08, 0.08, 0.09, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sd = bpy.data.lights.new("S", "SUN"); sd.energy = 4.5
sun = bpy.data.objects.new("S", sd); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
cd = bpy.data.cameras.new("C"); cd.lens = 55
cam = bpy.data.objects.new("C", cd); sc.collection.objects.link(cam); sc.camera = cam

views = {"front": (0, -1), "back": (0, 1), "left": (-1, 0), "right": (1, 0)}
for tag, (dx, dy) in views.items():
    cam.location = (center.x + dx * H * 2.2, center.y + dy * H * 2.2, center.z)
    cam.rotation_euler = (center - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUTDIR, f"{PREFIX}-{tag}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", sc.render.filepath)
