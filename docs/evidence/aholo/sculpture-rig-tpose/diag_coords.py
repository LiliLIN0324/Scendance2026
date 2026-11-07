"""诊断：受影响顶点到底落在哪个高度区间，以及 ground() 有没有真的把变换烘进顶点。"""
import bpy, sys, os
from mathutils import Vector, Matrix

SRC = os.path.abspath(sys.argv[sys.argv.index("--") + 1:][0])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
o = [x for x in bpy.context.scene.objects if x.type == "MESH"][0]
bpy.context.view_layer.objects.active = o
print("MW0", [[round(v, 4) for v in r] for r in o.matrix_world])
print("LOCAL_Z", round(min(v.co.z for v in o.data.vertices), 4), round(max(v.co.z for v in o.data.vertices), 4))

bpy.ops.object.select_all(action="DESELECT")
o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print("MW1", [[round(v, 4) for v in r] for r in o.matrix_world])
print("LOCAL_Z_AFTER", round(min(v.co.z for v in o.data.vertices), 4), round(max(v.co.z for v in o.data.vertices), 4))

hit = [v.co for v in o.data.vertices if abs(v.co.x) >= 0.10 and 0.78 <= v.co.z <= 1.52]
print("HIT_N", len(hit), "Z", round(min(p.z for p in hit), 3), round(max(p.z for p in hit), 3),
      "ABSX", round(max(abs(p.x) for p in hit), 3))
lo = [v.co for v in o.data.vertices if v.co.z < 0.30]
print("LOW_N", len(lo), "MAXABSX", round(max(abs(p.x) for p in lo), 4))
