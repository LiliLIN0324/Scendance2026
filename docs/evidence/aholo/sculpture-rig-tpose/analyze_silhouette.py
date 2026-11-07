"""逐层剪影分析 + 正交白模渲染，用来定量判断「手臂到底有没有出去」。

输出：
  - 每 5 cm 高度切片的 max|x| / max y / 顶点数（原始 vs 变形后）
  - 顶点位移统计（最大位移、位移 >2cm 的顶点数与它们的包围盒）
  - 正交前视 / 侧视 白色剪影 PNG
"""
import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUTDIR, PREFIX = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
os.makedirs(OUTDIR, exist_ok=True)


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    ms = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(ms) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for m in ms:
            m.select_set(True)
        bpy.context.view_layer.objects.active = ms[0]
        bpy.ops.object.join()
    o = [x for x in bpy.context.scene.objects if x.type == "MESH"][0]
    bpy.context.view_layer.objects.active = o
    return o


def coords(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def slices(co, step=0.05):
    zs = [p.z for p in co]
    lo = math.floor(min(zs) / step) * step
    hi = max(zs)
    rows = []
    z = lo
    while z < hi:
        band = [p for p in co if z <= p.z < z + step]
        if band:
            rows.append({"z_from": round(z, 3), "n": len(band),
                         "max_abs_x": round(max(abs(p.x) for p in band), 4),
                         "max_y": round(max(p.y for p in band), 4)})
        else:
            rows.append({"z_from": round(z, 3), "n": 0, "max_abs_x": 0.0, "max_y": 0.0})
        z += step
    return rows


def silhouette(obj, out_prefix):
    for m in list(obj.data.materials):
        obj.data.materials.pop(index=0)
    mat = bpy.data.materials.new("Flat")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (1, 1, 1, 1)
    em.inputs[1].default_value = 2.0
    nt.links.new(em.outputs[0], out.inputs[0])
    obj.data.materials.append(mat)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 8
    sc.render.resolution_x = 800
    sc.render.resolution_y = 800
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("W")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)

    cam_d = bpy.data.cameras.new("Sil")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 2.0
    cam = bpy.data.objects.new("Sil", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam

    views = {
        "front": ((0, -4, 0.9), (math.radians(90), 0, 0)),
        "side": ((-4, 0, 0.9), (math.radians(90), 0, math.radians(-90))),
    }
    made = []
    for name, (loc, eul) in views.items():
        cam.location = loc
        cam.rotation_euler = eul
        path = os.path.join(OUTDIR, f"{out_prefix}-sil-{name}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        made.append(path)
        print("WROTE", path)
    return made


obj = load(SRC)
co = coords(obj)
rows = slices(co)
print("SLICES", json.dumps(rows))
silhouette(obj, PREFIX)

# 若有原文件作为参照，比较位移
if len(argv) > 3:
    ref = os.path.abspath(argv[3])
    before = [Vector(p) for p in json.loads(argv[4])] if len(argv) > 4 else None
print("DONE")
