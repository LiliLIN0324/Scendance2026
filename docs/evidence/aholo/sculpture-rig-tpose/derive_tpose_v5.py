"""v5：放弃绕肩刚性旋转（v3/v4 已证明它把袖料甩到肩上、手臂本身不动），
改为对「臂袖区域」做带平滑衰减的横向外推，把臂展拉到接近人体比例。

权重：
  w = rx * rz            rx: |x| 从 0.10 渐变到 0.20
                         rz: z 从 0.78 渐入、1.52 渐出
  w = max(w, 手部团簇)    距检出的身前交叠手 < 0.13 m 的顶点也给满权重
位移：dx = DX * w * sign(x)，dz = DZ * w（略抬到肩线附近）
"""
import bpy, sys, json, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUTDIR = os.path.abspath(argv[0]), os.path.abspath(argv[1])
os.makedirs(OUTDIR, exist_ok=True)

DX = float(os.environ.get("TPOSE_DX", "0.34"))
DZ = float(os.environ.get("TPOSE_DZ", "0.08"))
HANDR = float(os.environ.get("TPOSE_HANDR", "0.13"))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_src():
    bpy.ops.import_scene.gltf(filepath=SRC)
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


def bbox(obj):
    # 必须按顶点坐标算：顶点被改过后 obj.bound_box 是滞后值，会导致 ground() 偏移
    mw = obj.matrix_world
    ps = [mw @ v.co for v in obj.data.vertices]
    return (Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps))),
            Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps))))


def measure(obj):
    mn, mx = bbox(obj)
    obj.data.calc_loop_triangles()
    return {"vertices": len(obj.data.vertices), "triangles": len(obj.data.loop_triangles),
            "bbox_min": [round(v, 6) for v in mn], "bbox_max": [round(v, 6) for v in mx],
            "width": round(mx.x - mn.x, 6), "depth": round(mx.y - mn.y, 6), "height": round(mx.z - mn.z, 6)}


def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def find_hand(co, mn, mx):
    H = mx.z - mn.z
    band = [p for p in co if mn.z + H * 0.55 <= p.z <= mn.z + H * 0.72]
    band.sort(key=lambda p: p.y, reverse=True)
    top = band[: max(int(len(band) * 0.02), 8)]
    return Vector((sum(p.x for p in top) / len(top), sum(p.y for p in top) / len(top),
                   sum(p.z for p in top) / len(top)))


def ground(obj):
    mn, mx = bbox(obj)
    obj.matrix_world = Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))) @ obj.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_normals=True)


reset()
src = import_src()
ground(src)
base = measure(src)
print("BASE", json.dumps(base))

reset()
obj = import_src()
ground(obj)
mn, mx = bbox(obj)
mw = obj.matrix_world
co = [mw @ v.co for v in obj.data.vertices]
hand = find_hand(co, mn, mx)

moved = 0
peak = 0.0
for v in obj.data.vertices:
    p = mw @ v.co
    ax = abs(p.x)
    rx = clamp01((ax - 0.10) / 0.10)
    rz = clamp01((p.z - 0.78) / 0.14) * clamp01((1.52 - p.z) / 0.14)
    w = rx * rz
    dh = (p - hand).length
    if dh < HANDR:
        w = max(w, clamp01((HANDR - dh) / 0.05))
    if w <= 0.0:
        continue
    moved += 1
    peak = max(peak, w)
    v.co = v.co + obj.matrix_world.inverted().to_3x3() @ Vector((math.copysign(DX * w, p.x), 0.0, DZ * w))

bpy.context.view_layer.update()
ground(obj)
m = measure(obj)
out = os.path.join(OUTDIR, "MODEL-tpose.glb")
export(obj, out)
m["file_bytes"] = os.path.getsize(out)
info = {"method": "lateral_shear", "dx": DX, "dz": DZ, "hand": [round(v, 4) for v in hand],
        "moved_vertices": moved, "peak_weight": round(peak, 3)}
rep = {"source": SRC, "source_bytes": os.path.getsize(SRC), "base": base, "result": m, **info,
       "deltas": {"width": round(m["width"] - base["width"], 6), "depth": round(m["depth"] - base["depth"], 6),
                  "height": round(m["height"] - base["height"], 6),
                  "bytes": os.path.getsize(out) - os.path.getsize(SRC)},
       "span_vs_height": round(m["width"] / m["height"], 3)}
with open(os.path.join(OUTDIR, "tpose-report.json"), "w", encoding="utf-8") as f:
    json.dump(rep, f, ensure_ascii=False, indent=2)
print("REPORT", json.dumps(rep, ensure_ascii=False))
