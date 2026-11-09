"""Bind the original folded-arm statue in place, with a small deformation test."""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


def smooth(low, high, value):
    t = min(1.0, max(0.0, (value - low) / (high - low)))
    return t * t * (3.0 - 2.0 * t)


def mesh_positions(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [evaluated.matrix_world @ v.co for v in evaluated.data.vertices]


source, output = map(Path, sys.argv[sys.argv.index("--") + 1:])
output.mkdir(parents=True, exist_ok=True)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
mesh, = (obj for obj in bpy.context.scene.objects if obj.type == "MESH")
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

floor_z = min(v.co.z for v in mesh.data.vertices)
height_offset = Vector((0, 0, floor_z))
armature = bpy.data.armatures.new("Sculpture")
rig = bpy.data.objects.new("Sculpture Rig", armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.show_in_front = True
bpy.ops.object.mode_set(mode="EDIT")
# Coordinates are in Blender's Z-up space, measured against this 1.8 m asset.
for name, parent, head, tail in (
    ("base", None, (0, 0, 0), (0, 0, 0.86)),
    ("torso", "base", (0, 0, 0.86), (0, 0, 1.49)),
    ("head", "torso", (0, 0, 1.49), (0, 0, 1.77)),
    ("folded_arms", "torso", (0, 0.02, 1.38), (0, 0.23, 1.08)),
):
    bone = armature.edit_bones.new(name)
    bone.head = Vector(head) + height_offset
    bone.tail = Vector(tail) + height_offset
    if parent:
        bone.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

groups = {bone.name: mesh.vertex_groups.new(name=bone.name) for bone in armature.bones}
for vertex in mesh.data.vertices:
    _, y, z = vertex.co - height_offset
    upper = smooth(0.84, 1.08, z)
    head = smooth(1.46, 1.62, z)
    # Keep the joined sleeves together and blend only their forward surface.
    arms = smooth(0.075, 0.23, y) * (1.0 - smooth(1.26, 1.48, z))
    weights = {
        "base": 1.0 - upper,
        "head": upper * head,
        "folded_arms": upper * (1.0 - head) * arms,
        "torso": upper * (1.0 - head) * (1.0 - arms),
    }
    for name, weight in weights.items():
        if weight > 0:
            groups[name].add([vertex.index], weight, "REPLACE")

mesh.parent = rig
modifier = mesh.modifiers.new("Sculpture Skin", "ARMATURE")
modifier.object = rig

scene = bpy.context.scene
scene.render.fps = 24
scene.frame_end = 49
for name, angle in (("torso", 5), ("head", 9), ("folded_arms", -6)):
    bone = rig.pose.bones[name]
    axis = bone.bone.matrix_local.to_3x3().inverted() @ Vector((1, 0, 0))
    bone.rotation_mode = "QUATERNION"
    for frame, factor in ((1, 0), (25, 1), (49, 0)):
        bone.rotation_quaternion = Quaternion(axis, math.radians(angle * factor))
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=name)
rig.animation_data.action.name = "Sculpture_Small_Bow"
scene.frame_set(1)

glb = output / "sculpture-local-rig.glb"
bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", export_animations=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(output / "sculpture-local-rig.blend"))

# Inspect the exported data and independently re-import it for deformation checks.
data = glb.read_bytes()
json_size = struct.unpack_from("<I", data, 12)[0]
document = json.loads(data[20:20 + json_size])
primitives = [p for m in document["meshes"] for p in m["primitives"]]
assert len(document["skins"]) == 1 and len(document["skins"][0]["joints"]) == 4
assert all({"JOINTS_0", "WEIGHTS_0"} <= p["attributes"].keys() for p in primitives)
assert len(document["animations"]) == 1

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
scene = bpy.context.scene
mesh, = (obj for obj in scene.objects if obj.type == "MESH" and any(mod.type == "ARMATURE" for mod in obj.modifiers))
rig, = (obj for obj in scene.objects if obj.type == "ARMATURE")
assert rig.animation_data.action is not None
assert max(abs(sum(g.weight for g in v.groups) - 1.0) for v in mesh.data.vertices) < 1e-5
first_frame, last_frame = map(round, rig.animation_data.action.frame_range)
peak_frame = (first_frame + last_frame) // 2
print("REIMPORTED_FRAMES", first_frame, peak_frame, last_frame)
scene.frame_set(first_frame)
rest = mesh_positions(mesh)
scene.frame_set(peak_frame)
posed = mesh_positions(mesh)
scene.frame_set(last_frame)
loop = mesh_positions(mesh)
deltas = [(a - b).length for a, b in zip(rest, posed)]
base_max = max(d for p, d in zip(rest, deltas) if p.z <= floor_z + 0.84)
loop_max = max((a - b).length for a, b in zip(rest, loop))
print("DEFORMATION", max(deltas), base_max, loop_max)
assert max(deltas) > 0.04 and base_max < 1e-5 and loop_max < 1e-5
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
report = {
    "source_sha256": source_hash,
    "joints": [bone.name for bone in rig.data.bones],
    "clip": document["animations"][0]["name"],
    "vertices": len(rest),
    "vertices_moved_over_1cm": sum(d > 0.01 for d in deltas),
    "max_displacement_m": max(deltas),
    "max_base_displacement_m": base_max,
    "loop_end_displacement_m": loop_max,
}
(output / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("VALIDATED", json.dumps(report), flush=True)

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 8
scene.cycles.use_denoising = True
scene.render.resolution_x = 520
scene.render.resolution_y = 620
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new("Preview Ambient")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.18, 0.18, 1.0)
camera_data = bpy.data.cameras.new("Preview")
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2.1
camera = bpy.data.objects.new("Preview", camera_data)
scene.collection.objects.link(camera)
camera.location = (-3, -4, 1.75 + floor_z)
camera.rotation_euler = (Vector((0, 0, 0.92 + floor_z)) - camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera
light_data = bpy.data.lights.new("Key", "AREA")
light_data.energy = 400
light_data.shape = "DISK"
light_data.size = 3
light = bpy.data.objects.new("Key", light_data)
scene.collection.objects.link(light)
light.location = (-2, -3, 3 + floor_z)
light.rotation_euler = (Vector((0, 0, 1 + floor_z)) - light.location).to_track_quat("-Z", "Y").to_euler()
for frame, name in ((first_frame, "rest"), (peak_frame, "bow")):
    scene.frame_set(frame)
    scene.render.filepath = str(output / (name + ".png"))
    bpy.ops.render.render(write_still=True)
