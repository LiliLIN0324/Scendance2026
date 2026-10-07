"""Generate Scendance parametric assets with Blender, headless.

This mirrors `supabase/functions/_shared/parametric.ts` so the same parameter
contract produces the same solid: metres, +Y up in the exported GLB, footprint
centred on X/Z, base sitting on Y=0, and a bounding box exactly equal to the
requested width/depth/height.

Blender works in Z-up metres. The glTF exporter converts to Y-up, so this script
builds width along X, depth along Y and height along Z, and only the bounds check
in `verify-parametric.ts` can prove that conversion happened.

Usage:
  blender --background --python tools/blender/build_parametric.py -- \
    --params params.json --out model.glb

`params.json` uses the same shape as `parametricParametersSchema`. The script
deliberately does not re-implement that schema's rules; `verify-parametric.ts`
validates the parameters with the shared zod schema before calling Blender.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback

import bpy
from mathutils import Matrix

RESULT_MARKER = "SCENDANCE_PARAMETRIC_RESULT"

OBJECTS: list = []


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Read only the arguments Blender passes after a bare `--`."""
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(prog="build_parametric.py")
    parser.add_argument("--params", required=True, help="path to the parameter JSON file")
    parser.add_argument("--out", required=True, help="path of the GLB file to write")
    parser.add_argument("--color", default=None, help="override the #rrggbb surface colour")
    return parser.parse_args(args)


def srgb_to_linear(value: float) -> float:
    """Blender base colours are linear; the contract colour is sRGB hex."""
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgb(color: str) -> tuple[float, float, float]:
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(srgb_to_linear(channel) for channel in channels)


def reset_scene() -> None:
    """Start empty so the export holds exactly one scene and no cameras or lights."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_surface_material(color: str):
    material = bpy.data.materials.new("surface")
    material.use_nodes = True
    principled = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        raise RuntimeError("Principled BSDF node not found")
    red, green, blue = hex_to_linear_rgb(color)
    for name, value in (("Base Color", (red, green, blue, 1.0)), ("Metallic", 0.0), ("Roughness", 0.7)):
        socket = principled.inputs.get(name)
        if socket is None:
            raise RuntimeError(f"Principled BSDF input '{name}' not found")
        socket.default_value = value
    return material


def add_box(name: str, width: float, depth: float, height: float,
            cx: float = 0.0, cy: float = 0.0, cz: float | None = None):
    """Axis-aligned box centred on (cx, cy), base at cz, or centred vertically when cz is omitted."""
    if cz is None:
        cz = height / 2.0
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.name = name
    # The unit cube spans ±0.5, so scaling the mesh data gives exactly width/depth/height.
    obj.data.transform(Matrix.Diagonal((width, depth, height, 1.0)))
    obj.location = (cx, cy, cz)
    OBJECTS.append(obj)
    return obj


def add_cylinder(name: str, diameter: float, height: float, cz: float):
    """Vertical cylinder, 32 segments from angle 0, so the bounds reach exactly the radius on both axes."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=diameter / 2.0, depth=height, location=(0, 0, cz))
    obj = bpy.context.active_object
    obj.name = name
    OBJECTS.append(obj)
    return obj


def add_legs(width: float, depth: float, height: float, thickness: float) -> None:
    """Four legs placed so their outer faces land exactly on ±width/2 and ±depth/2."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box("leg", thickness, thickness, height,
                    cx=sx * (width - thickness) / 2.0,
                    cy=sy * (depth - thickness) / 2.0,
                    cz=height / 2.0)


def build_table(p: dict) -> None:
    leg_height = p["height"] - p["topThickness"]
    if p["variant"] == "round":
        add_cylinder("top", p["width"], p["topThickness"], p["height"] - p["topThickness"] / 2.0)
    else:
        add_box("top", p["width"], p["depth"], p["topThickness"], cz=p["height"] - p["topThickness"] / 2.0)
    if p["legs"] == "pedestal":
        add_cylinder("pedestal", p["legThickness"], leg_height, leg_height / 2.0)
    elif p["variant"] == "round":
        # Keep the leg footprint inside the round top, as parametric.ts does.
        footprint = min(p["width"] / math.sqrt(2), p["width"] - p["legThickness"])
        add_legs(footprint, footprint, leg_height, p["legThickness"])
    else:
        add_legs(p["width"], p["depth"], leg_height, p["legThickness"])


def build_chair(p: dict) -> None:
    seat = p["height"] if p["variant"] == "stool" else p["seatHeight"]
    add_box("seat", p["width"], p["depth"], p["seatThickness"], cz=seat - p["seatThickness"] / 2.0)
    add_legs(p["width"], p["depth"], seat - p["seatThickness"], p["legThickness"])
    if p["variant"] == "backed":
        add_box("back", p["width"], p["backThickness"], p["height"] - seat,
                cy=-(p["depth"] - p["backThickness"]) / 2.0,
                cz=(p["height"] + seat) / 2.0)


def build_counter(p: dict) -> None:
    height = p["height"] - p["topThickness"]
    thickness = p["panelThickness"]
    if p["variant"] == "straight":
        add_box("top", p["width"], p["depth"], p["topThickness"], cz=p["height"] - p["topThickness"] / 2.0)
        add_box("front", p["width"], thickness, height, cy=-(p["depth"] - thickness) / 2.0, cz=height / 2.0)
        for sx in (-1, 1):
            add_box("side", thickness, p["depth"], height, cx=sx * (p["width"] - thickness) / 2.0, cz=height / 2.0)
    else:
        arm = p["armDepth"]
        add_box("top-main", p["width"], arm, p["topThickness"],
                cy=-(p["depth"] - arm) / 2.0, cz=p["height"] - p["topThickness"] / 2.0)
        add_box("top-return", arm, p["depth"] - arm, p["topThickness"],
                cx=-(p["width"] - arm) / 2.0, cy=arm / 2.0, cz=p["height"] - p["topThickness"] / 2.0)
        add_box("front", p["width"], thickness, height, cy=-(p["depth"] - thickness) / 2.0, cz=height / 2.0)
        add_box("return-side", thickness, p["depth"], height, cx=-(p["width"] - thickness) / 2.0, cz=height / 2.0)
        add_box("main-end", thickness, arm, height, cx=(p["width"] - thickness) / 2.0,
                cy=-(p["depth"] - arm) / 2.0, cz=height / 2.0)
        add_box("return-end", arm, thickness, height, cx=-(p["width"] - arm) / 2.0,
                cy=(p["depth"] - thickness) / 2.0, cz=height / 2.0)


def build_platform(p: dict) -> None:
    add_box("platform", p["width"], p["depth"], p["height"])


def build_backdrop(p: dict) -> None:
    add_box("base", p["width"], p["depth"], p["baseHeight"])
    add_box("panel", p["width"], p["panelThickness"], p["height"] - p["baseHeight"],
            cz=(p["height"] + p["baseHeight"]) / 2.0)


def build_cabinet(p: dict) -> None:
    thickness = p["panelThickness"]
    for sx in (-1, 1):
        add_box("side", thickness, p["depth"], p["height"],
                cx=sx * (p["width"] - thickness) / 2.0, cz=p["height"] / 2.0)
    for level in (thickness / 2.0, p["height"] - thickness / 2.0):
        add_box("horizontal", p["width"] - 2 * thickness, p["depth"], thickness, cz=level)
    add_box("back", p["width"] - 2 * thickness, thickness, p["height"] - 2 * thickness,
            cy=-(p["depth"] - thickness) / 2.0, cz=p["height"] / 2.0)
    for index in range(1, p["shelves"] + 1):
        add_box("shelf", p["width"] - 2 * thickness, p["depth"] - thickness, thickness,
                cy=thickness / 2.0,
                cz=thickness + (p["height"] - 2 * thickness) * index / (p["shelves"] + 1))
    if p["variant"] == "closed":
        add_box("door", p["width"] - 2 * thickness, thickness, p["height"] - 2 * thickness,
                cy=(p["depth"] - thickness) / 2.0, cz=p["height"] / 2.0)


BUILDERS = {
    "table": build_table,
    "chair": build_chair,
    "counter": build_counter,
    "platform": build_platform,
    "backdrop": build_backdrop,
    "cabinet": build_cabinet,
}


def measure_bounds() -> dict:
    """World-space bounds expressed in glTF axes (X width, Y height, Z depth)."""
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for obj in OBJECTS:
        for corner in obj.bound_box:
            world = (obj.matrix_world @ Matrix.Translation(corner)).translation
            # Blender X -> glTF X, Blender Y -> glTF -Z, Blender Z -> glTF Y
            gltf = (world.x, world.z, -world.y)
            for axis in range(3):
                lo[axis] = min(lo[axis], gltf[axis])
                hi[axis] = max(hi[axis], gltf[axis])
    return {
        "width": hi[0] - lo[0],
        "height": hi[1] - lo[1],
        "depth": hi[2] - lo[2],
        "min": lo,
        "max": hi,
    }


def count_triangles() -> int:
    """Triangles the exporter will emit, summed over loop triangles of every object."""
    total = 0
    for obj in OBJECTS:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def export_glb(path: str) -> None:
    """Export with only the options this Blender build actually supports."""
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    requested = {
        "filepath": path,
        "export_format": "GLB",
        "export_apply": True,
        "export_animations": False,
        "export_yup": True,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
        "use_selection": False,
    }
    kwargs = {key: value for key, value in requested.items() if key == "filepath" or key in supported}
    bpy.ops.export_scene.gltf(**kwargs)


def main() -> int:
    args = parse_args(sys.argv)
    with open(args.params, "r", encoding="utf-8") as handle:
        parameters = json.load(handle)
    family = parameters.get("family")
    builder = BUILDERS.get(family)
    if builder is None:
        raise ValueError(f"unsupported family: {family!r}")

    reset_scene()
    builder(parameters)

    material = make_surface_material(args.color or parameters.get("color") or "#cbb68e")
    for obj in OBJECTS:
        obj.data.materials.append(material)

    bounds = measure_bounds()
    triangles = count_triangles()
    export_glb(args.out)

    print(f"{RESULT_MARKER} {json.dumps({'family': family, 'objects': len(OBJECTS), 'triangles': triangles, 'blenderVersion': bpy.app.version_string, 'measuredBounds': bounds})}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
