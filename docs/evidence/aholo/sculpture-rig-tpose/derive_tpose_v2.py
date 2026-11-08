"""雕塑 T-Pose 派生 v2：临时骨架 + 手工距离权重（auto/envelope 失败后的可靠退路）
-> 双臂外张 -> apply -> 删骨架 -> 导出 GLB。只改副本。
"""
import bpy, sys, json, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUTDIR = argv[0], argv[1]
os.makedirs(OUTDIR, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_src():
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    bpy.context.view_layer.objects.active = obj
    return obj


def world_bbox(obj):
    mw = obj.matrix_world
    pts = [mw @ Vector(c) for c in obj.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def measure(obj):
    mn, mx = world_bbox(obj)
    me = obj.data
    me.calc_loop_triangles()
    return {"vertices": len(me.vertices), "triangles": len(me.loop_triangles),
            "bbox_min": [round(v, 6) for v in mn], "bbox_max": [round(v, 6) for v in mx],
            "width": round(mx.x - mn.x, 6), "depth": round(mx.y - mn.y, 6), "height": round(mx.z - mn.z, 6)}


def segment_distance(p, a, b):
    ab = b - a
    denom = ab.dot(ab)
    t = 0.0 if denom < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length, t


def build_and_weight(obj, angle_deg, sign):
    mn, mx = world_bbox(obj)
    H = mx.z - mn.z
    z_sh = mn.z + H * 0.80
    y_sh = mn.y + (mx.y - mn.y) * 0.50
    y_hand = mn.y + (mx.y - mn.y) * 0.86
    z_hand = mn.z + H * 0.62

    # 肩宽：0.70~0.88 身高带内的 x 分布，取 85 分位
    mw = obj.matrix_world
    co = [mw @ v.co for v in obj.data.vertices]
    band = [abs(p.x) for p in co if mn.z + H * 0.70 <= p.z <= mn.z + H * 0.88]
    band.sort()
    sx = max(band[int(len(band) * 0.85)] if band else 0.15, (mx.x - mn.x) * 0.10)
    sx = min(sx, (mx.x - mn.x) * 0.28)

    arm = bpy.data.armatures.new("TPoseRig")
    rig = bpy.data.objects.new("TPoseRig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    root = eb.new("root"); root.head = (0, 0, mn.z); root.tail = (0, 0, mn.z + H * 0.42)
    spine = eb.new("spine"); spine.head = root.tail; spine.tail = (0, 0, z_sh); spine.parent = root; spine.use_connect = True
    segs = {}
    for side, s in (("L", sx), ("R", -sx)):
        up = eb.new(f"upperarm.{side}")
        h = Vector((s, y_sh, z_sh))
        tail = Vector((s * 0.30, y_hand, z_hand))
        up.head = h; up.tail = tail; up.parent = spine
        fo = eb.new(f"forearm.{side}")
        fo.head = tail; fo.tail = Vector((0.0, y_hand + (mx.y - mn.y) * 0.06, z_hand - 0.04)); fo.parent = up; fo.use_connect = True
        segs[f"upperarm.{side}"] = (h, tail)
        segs[f"forearm.{side}"] = (fo.head, fo.tail)
    bpy.ops.object.mode_set(mode="OBJECT")

    # 手工距离权重：R=0.20，按靠近程度做平滑衰减，其余归 spine。
    groups = {n: obj.vertex_groups.new(name=n) for n in segs}
    spine_g = obj.vertex_groups.new(name="spine")
    R = 0.20
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        best = ("spine", 0.0)
        for name, (a, b) in segs.items():
            side_sign = 1 if name.endswith(".L") else -1
            if p.x * side_sign < -sx * 0.15:
                continue
            d, t = segment_distance(p, a, b)
            w = max(0.0, 1.0 - (d / R) ** 1.5)
            if w > best[1]:
                best = (name, w)
        w = best[1]
        if w > 0.02:
            groups[best[0]].add([v.index], w, "REPLACE")
            spine_g.add([v.index], max(1.0 - w, 0.001), "REPLACE")
        else:
            spine_g.add([v.index], 1.0, "REPLACE")

    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

    # 摆姿势：绕世界 Y 轴转，方向取能把手甩向外侧的那个符号
    for side in ("L", "R"):
        for name in (f"upperarm.{side}", f"forearm.{side}"):
            pb = rig.pose.bones[name]
            M = pb.bone.matrix_local.to_3x3()
            rot = Matrix.Rotation(math.radians(angle_deg) * (sign if side == "L" else -sign), 3, "Y")
            pb.matrix_basis = (M.inverted() @ rot @ M).to_4x4()
    bpy.context.view_layer.update()
    return rig, {"shoulder_x": round(sx, 4), "shoulder_z": round(z_sh, 4), "sign": sign, "angle": angle_deg}


def apply_and_strip(obj, rig):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(rig, do_unlink=True)


def normalize_ground(obj):
    mn, mx = world_bbox(obj)
    obj.matrix_world = Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))) @ obj.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def render_views(obj, prefix):
    try:
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = 24
        sc.render.resolution_x = 640
        sc.render.resolution_y = 640
        w = bpy.data.worlds.new("W")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.06, 0.07, 1)
        mn, mx = world_bbox(obj)
        H = mx.z - mn.z
        center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
        sd = bpy.data.lights.new("S", "SUN"); sd.energy = 4
        sun = bpy.data.objects.new("S", sd); sc.collection.objects.link(sun)
        sun.rotation_euler = (math.radians(55), 0, math.radians(30))
        cd = bpy.data.cameras.new("C"); cd.lens = 50
        cam = bpy.data.objects.new("C", cd); sc.collection.objects.link(cam); sc.camera = cam
        for tag, dist in (("front", -1), ("back", 1)):
            cam.location = (center.x, center.y + dist * H * 2.2, center.z)
            cam.rotation_euler = (center - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(OUTDIR, f"{prefix}-{tag}.png")
            bpy.ops.render.render(write_still=True)
        return True
    except Exception as e:
        print("RENDER_FAIL", e)
        return False


def export_glb(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_normals=True)


reset()
src_obj = import_src()
base = measure(src_obj)
print("BASE", json.dumps(base))
render_views(src_obj, "before")

trials = []
best = None
for sign in (1, -1):
    for angle in (85, 100):
        if best:
            break
        reset()
        obj = import_src()
        rig, info = build_and_weight(obj, angle, sign)
        apply_and_strip(obj, rig)
        normalize_ground(obj)
        m = measure(obj)
        m.update(info)
        trials.append(m)
        print("TRIAL", json.dumps(m))
        if m["width"] > base["width"] * 1.35:
            best = (obj, m)

if best is None:
    raise SystemExit("FAILED: 没有找到能让宽度显著变大的手臂外张方向")

obj, m = best
out = os.path.join(OUTDIR, "MODEL-tpose.glb")
export_glb(obj, out)
m["file"] = out
m["file_bytes"] = os.path.getsize(out)
render_views(obj, "after")

report = {"source": SRC, "source_bytes": os.path.getsize(SRC), "base": base, "trials": trials,
          "chosen": m, "deltas": {"width": round(m["width"] - base["width"], 6),
                                  "depth": round(m["depth"] - base["depth"], 6),
                                  "height": round(m["height"] - base["height"], 6),
                                  "bytes": os.path.getsize(out) - os.path.getsize(SRC)}}
with open(os.path.join(OUTDIR, "tpose-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("REPORT", json.dumps(report, ensure_ascii=False))
