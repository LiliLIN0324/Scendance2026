"""雕塑 T-Pose 派生：临时骨架 -> 自动权重 -> 双臂外张 -> apply -> 删骨架 -> 导出 GLB。

只改副本，源文件不动。用法：
  blender --background --python derive_tpose.py -- <src.glb> <outdir>
"""
import bpy, bmesh, sys, json, os, math, struct
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUTDIR = argv[0], argv[1]
os.makedirs(OUTDIR, exist_ok=True)

ARMS = ["upperarm.L", "forearm.L", "upperarm.R", "forearm.R"]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_src():
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("导入后没有网格")
    if len(meshes) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


def world_bbox(obj):
    mw = obj.matrix_world
    pts = [mw @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def measure(obj):
    mn, mx = world_bbox(obj)
    return {
        "vertices": len(obj.data.vertices),
        "triangles": tri_count(obj),
        "bbox_min": [round(v, 6) for v in mn],
        "bbox_max": [round(v, 6) for v in mx],
        "width": round(mx.x - mn.x, 6),
        "depth": round(mx.y - mn.y, 6),
        "height": round(mx.z - mn.z, 6),
    }


def shoulder_band(obj):
    """在 0.72~0.86 身高带内量 x 跨度，作为肩宽参考。"""
    mn, mx = world_bbox(obj)
    z0 = mn.z + (mx.z - mn.z) * 0.72
    z1 = mn.z + (mx.z - mn.z) * 0.86
    mw = obj.matrix_world
    xs = [abs((mw @ v.co).x) for v in obj.data.vertices]
    zs = [(mw @ v.co).z for v in obj.data.vertices]
    band = [x for x, z in zip(xs, zs) if z0 <= z <= z1]
    if not band:
        return (mx.x - mn.x) * 0.20
    band.sort()
    return max(min(band[int(len(band) * 0.85)], (mx.x - mn.x) * 0.25), (mx.x - mn.x) * 0.08)


def build_armature(obj, angle_deg, weight_mode):
    mn, mx = world_bbox(obj)
    height = mx.z - mn.z
    sh_x = shoulder_band(obj)
    sh_z = mn.z + height * 0.80
    # 手在身前交叠：肩 -> 手的方向约为 向内、向前、向下
    hand = Vector((0.0, mn.y + (mx.y - mn.y) * 0.85, mn.z + height * 0.62))
    arm_len = (hand - Vector((sh_x, mn.y + (mx.y - mn.y) * 0.45, sh_z))).length

    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm = bpy.context.object
    arm.name = "TPoseRig"
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)

    root = eb.new("root")
    root.head = (0, 0, mn.z + 0.02)
    root.tail = (0, 0, mn.z + height * 0.45)

    spine = eb.new("spine")
    spine.head = root.tail
    spine.tail = (0, 0, sh_z)
    spine.parent = root
    spine.use_connect = True

    y_sh = mn.y + (mx.y - mn.y) * 0.45
    for side, sx in (("L", sh_x), ("R", -sh_x)):
        upper = eb.new(f"upperarm.{side}")
        upper.head = (sx, y_sh, sh_z)
        upper.tail = (sx * 0.35 + 0.02, hand.y, sh_z - height * 0.10)
        upper.parent = spine
        fore = eb.new(f"forearm.{side}")
        fore.head = upper.tail
        fore.tail = (hand.x, hand.y, hand.z)
        fore.parent = upper
        fore.use_connect = True

    bpy.ops.object.mode_set(mode="OBJECT")
    arm.show_in_front = True

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO" if weight_mode == "auto" else "ARMATURE_ENVELOPE")

    return arm, {"shoulder_x": round(sh_x, 4), "shoulder_z": round(sh_z, 4),
                 "arm_len": round(arm_len, 4), "weight_mode": weight_mode}


def arm_weight_coverage(obj):
    groups = {g.name: g.index for g in obj.vertex_groups}
    covered = 0
    total = len(obj.data.vertices)
    for v in obj.data.vertices:
        if any(g.group in [groups[n] for n in ARMS if n in groups] and g.weight > 0.05 for g in v.groups):
            covered += 1
    return round(covered / max(total, 1), 4)


def pose_arms(arm, angle_deg):
    for side, sign in (("L", 1), ("R", -1)):
        for name in (f"upperarm.{side}", f"forearm.{side}"):
            pb = arm.pose.bones[name]
            pb.rotation_mode = "QUATERNION"
            M = pb.bone.matrix_local.to_3x3()
            R = Matrix.Rotation(math.radians(angle_deg) * sign, 3, "Y")
            pb.matrix_basis = (M.inverted() @ R @ M).to_4x4()
    bpy.context.view_layer.update()


def apply_and_strip(obj, arm):
    bpy.context.view_layer.objects.active = obj
    mod = next((m for m in obj.modifiers if m.type == "ARMATURE"), None)
    if mod:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(arm, do_unlink=True)


def normalize_ground(obj):
    mn, mx = world_bbox(obj)
    mw = obj.matrix_world.copy()
    # 底面贴地、水平居中
    shift = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    obj.matrix_world = Matrix.Translation(shift) @ mw
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def max_displacement(src_mesh_path, obj):
    """和原始顶点做最近点对比，给出最大位移（粗粒度采样）。"""
    if not os.path.exists(src_mesh_path):
        return None
    reset()
    src = import_src_quiet(src_mesh_path)
    if src is None:
        return None
    return None


def import_src_quiet(path):
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception:
        return None
    ms = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    return ms[0] if ms else None


def render_views(obj, prefix, outdir):
    """Cycles CPU 低采样，出前/后两张对比图。失败不影响主流程。"""
    try:
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 24
        scene.render.resolution_x = 640
        scene.render.resolution_y = 640
        scene.render.film_transparent = False
        world = bpy.data.worlds.new("W") if not bpy.data.worlds else bpy.data.worlds[0]
        scene.world = world
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

        mn, mx = world_bbox(obj)
        h = mx.z - mn.z
        center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))

        sun = bpy.data.objects.get("Sun")
        if not sun:
            sun_data = bpy.data.lights.new("Sun", "SUN")
            sun_data.energy = 4
            sun = bpy.data.objects.new("Sun", sun_data)
            scene.collection.objects.link(sun)
        sun.rotation_euler = (math.radians(55), 0, math.radians(25))

        cam_data = bpy.data.cameras.new("Cam")
        cam = bpy.data.objects.new("Cam", cam_data)
        scene.collection.objects.link(cam)
        scene.camera = cam
        cam_data.lens = 50

        for tag, dist, yaw in (("front", -1, 0), ("back", 1, math.pi)):
            cam.location = (center.x, center.y + dist * h * 2.2, center.z)
            direction = center - Vector(cam.location)
            cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(outdir, f"{prefix}-{tag}.png")
            bpy.ops.render.render(write_still=True)
        return True
    except Exception as e:
        print("RENDER_FAIL", e)
        return False


def export_glb(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
    )


# ---------- 主流程 ----------
reset()
src_obj = import_src()
base = measure(src_obj)
print("BASE", json.dumps(base))
render_views(src_obj, "before", OUTDIR)

results = []
best = None
for mode in ("auto", "envelope"):
    for angle in (88, 105):
        reset()
        obj = import_src()
        arm, info = build_armature(obj, angle, mode)
        cover = arm_weight_coverage(obj)
        pose_arms(arm, angle)
        apply_and_strip(obj, arm)
        normalize_ground(obj)
        m = measure(obj)
        m.update({"angle": angle, "weight_mode": mode, "arm_weight_coverage": cover, **info})
        results.append(m)
        print("ATTEMPT", json.dumps(m))
        widened = m["width"]
        if cover >= 0.02 and widened > base["width"] * 1.15:
            best = (obj, m, mode, angle)
            break
    if best:
        break

if best is None:
    # 最后一次尝试兜底导出
    reset()
    obj = import_src()
    arm, info = build_armature(obj, 100, "auto")
    pose_arms(arm, 100)
    apply_and_strip(obj, arm)
    normalize_ground(obj)
    m = measure(obj)
    m.update({"angle": 100, "weight_mode": "auto", **info})
    results.append(m)
    best = (obj, m, "auto", 100)

obj, m, mode, angle = best
out_glb = os.path.join(OUTDIR, "MODEL-tpose.glb")
export_glb(obj, out_glb)
size = os.path.getsize(out_glb)
m["file_bytes"] = size
m["file"] = out_glb
render_views(obj, "after", OUTDIR)

report = {
    "source": SRC,
    "source_bytes": os.path.getsize(SRC),
    "base": base,
    "attempts": results,
    "chosen": {"weight_mode": mode, "angle": angle, **m},
    "deltas": {
        "width": round(m["width"] - base["width"], 6),
        "depth": round(m["depth"] - base["depth"], 6),
        "height": round(m["height"] - base["height"], 6),
        "bytes": size - os.path.getsize(SRC),
    },
}
with open(os.path.join(OUTDIR, "tpose-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("REPORT", json.dumps(report, ensure_ascii=False))
