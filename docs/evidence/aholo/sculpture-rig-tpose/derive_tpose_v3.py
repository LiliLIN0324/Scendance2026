"""v3：按几何检测手臂轴（肩 -> 身前交叠的手），单根上臂骨绕肩外展，apply 后导出。
auto / envelope 权重在这个融合网格上都失败，所以用手工胶囊权重。
"""
import bpy, sys, json, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUTDIR = os.path.abspath(argv[0]), os.path.abspath(argv[1])
os.makedirs(OUTDIR, exist_ok=True)


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
    mw = obj.matrix_world
    ps = [mw @ Vector(c) for c in obj.bound_box]
    return (Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps))),
            Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps))))


def measure(obj):
    mn, mx = bbox(obj)
    obj.data.calc_loop_triangles()
    return {"vertices": len(obj.data.vertices), "triangles": len(obj.data.loop_triangles),
            "bbox_min": [round(v, 6) for v in mn], "bbox_max": [round(v, 6) for v in mx],
            "width": round(mx.x - mn.x, 6), "depth": round(mx.y - mn.y, 6), "height": round(mx.z - mn.z, 6)}


def analyze_arms(obj):
    mw = obj.matrix_world
    co = [mw @ v.co for v in obj.data.vertices]
    mn, mx = bbox(obj)
    H = mx.z - mn.z
    z_lo, z_hi = mn.z + H * 0.55, mn.z + H * 0.90
    band = [p for p in co if z_lo <= p.z <= z_hi]
    # 身前交叠的手：该带内 y 最大的一撮
    band.sort(key=lambda p: p.y, reverse=True)
    top = band[: max(int(len(band) * 0.02), 8)]
    hand = Vector((sum(p.x for p in top) / len(top), sum(p.y for p in top) / len(top),
                   sum(p.z for p in top) / len(top)))
    # 肩：0.78~0.86 带内 |x| 的 85 分位
    sh_band = sorted(abs(p.x) for p in co if mn.z + H * 0.78 <= p.z <= mn.z + H * 0.86)
    sx = sh_band[int(len(sh_band) * 0.85)] if sh_band else (mx.x - mn.x) * 0.18
    sx = max(min(sx, (mx.x - mn.x) * 0.26), (mx.x - mn.x) * 0.10)
    return hand, sx, mn.z + H * 0.80, H


def build(obj, angle, sign):
    hand, sx, sz, H = analyze_arms(obj)
    rig_d = bpy.data.armatures.new("TPoseRig")
    rig = bpy.data.objects.new("TPoseRig", rig_d)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig_d.edit_bones
    mn, _ = bbox(obj)
    root = eb.new("root"); root.head = (0, 0, mn.z); root.tail = (0, 0, mn.z + H * 0.4)
    spine = eb.new("spine"); spine.head = root.tail; spine.tail = (0, 0, sz)
    spine.parent = root; spine.use_connect = True
    segs = {}
    for side, s in (("L", sx), ("R", -sx)):
        head = Vector((s, hand.y * 0.35, sz))
        up = eb.new(f"upperarm.{side}"); up.head = head; up.tail = hand; up.parent = spine
        eb.new(f"forearm.{side}")
        fo = rig_d.edit_bones[f"forearm.{side}"]
        fo.head = hand; fo.tail = hand + (hand - head) * 0.6; fo.parent = up; fo.use_connect = True
        segs[f"upperarm.{side}"] = (head, hand)
    bpy.ops.object.mode_set(mode="OBJECT")

    obj.vertex_groups.clear()
    g = {n: obj.vertex_groups.new(name=n) for n in segs}
    spine_g = obj.vertex_groups.new(name="spine")
    R = 0.15
    mw = obj.matrix_world
    for v in obj.data.vertices:
        p = mw @ v.co
        best_name, best_w = "spine", 1.0
        for name, (a, b) in segs.items():
            side_sign = 1 if name.endswith(".L") else -1
            if p.x * side_sign < -0.02:
                continue
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-9)))
            d = (p - (a + ab * t)).length
            w = (1.0 - (d / R) ** 2) ** 2 if d < R else 0.0
            if w > 0.02 and w > (1.0 - best_w):
                best_name, best_w = name, w
        if best_name == "spine":
            spine_g.add([v.index], 1.0, "REPLACE")
        else:
            g[best_name].add([v.index], best_w, "REPLACE")
            spine_g.add([v.index], max(1.0 - best_w, 0.001), "REPLACE")

    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    for side in ("L", "R"):
        pb = rig.pose.bones[f"upperarm.{side}"]
        M = pb.bone.matrix_local.to_3x3()
        rot = Matrix.Rotation(math.radians(angle) * (sign if side == "L" else -sign), 3, "Y")
        pb.matrix_basis = (M.inverted() @ rot @ M).to_4x4()
    bpy.context.view_layer.update()
    return rig, {"shoulder_x": round(sx, 4), "hand": [round(v, 4) for v in hand], "sign": sign, "angle": angle}


def apply_strip(obj, rig):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(rig, do_unlink=True)


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
base = measure(src)
print("BASE", json.dumps(base))

trials, best = [], None
for sign in (1, -1):
    for angle in (90, 105):
        if best:
            break
        reset()
        o = import_src()
        rig, info = build(o, angle, sign)
        apply_strip(o, rig)
        ground(o)
        m = measure(o)
        m.update(info)
        trials.append(m)
        print("TRIAL", json.dumps(m))
        if m["width"] > base["width"] * 1.5:
            best = (o, m)

if best is None:
    raise SystemExit("FAILED: 手臂外展后宽度仍不够")

o, m = best
out = os.path.join(OUTDIR, "MODEL-tpose.glb")
export(o, out)
m["file"] = out
m["file_bytes"] = os.path.getsize(out)
rep = {"source": SRC, "source_bytes": os.path.getsize(SRC), "base": base, "trials": trials, "chosen": m,
       "deltas": {"width": round(m["width"] - base["width"], 6), "depth": round(m["depth"] - base["depth"], 6),
                  "height": round(m["height"] - base["height"], 6),
                  "bytes": os.path.getsize(out) - os.path.getsize(SRC)}}
with open(os.path.join(OUTDIR, "tpose-report.json"), "w", encoding="utf-8") as f:
    json.dump(rep, f, ensure_ascii=False, indent=2)
print("REPORT", json.dumps(rep, ensure_ascii=False))
