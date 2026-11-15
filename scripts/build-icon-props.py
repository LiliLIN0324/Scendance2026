"""Create original, metric GLB props for the outdoor planning icon library.

Run from the repository root with Python, Pillow and NumPy. Each output uses
original geometry and artwork. No OnePlan SVG content is copied into the GLBs.
"""
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

LIBRARY = Path("assets/library")
METAL = "#aab4b7"
DARK = "#293b45"
RED = "#c52a2a"
WHITE = "#f9f6e9"
BLUE = "#24619a"
GOLD = "#f3b53d"
GREEN = "#337356"
WOOD = "#8c603b"


def font(size):
    for path in ("C:/Windows/Fonts/arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def rgb(hex_color):
    return tuple(bytes.fromhex(hex_color[1:]))


class Prop:
    def __init__(self):
        self.parts = []

    def mesh(self, points, faces, color, image=None, uv=None):
        self.parts.append((np.asarray(points), faces, color, image, uv))

    def prism(self, ring, offset, color):
        ring = np.asarray(ring)
        n = len(ring)
        points = np.concatenate([ring, ring + offset])
        faces = [(0, i + 1, i) for i in range(1, n - 1)]
        faces += [(n, n + i, n + i + 1) for i in range(1, n - 1)]
        for i in range(n):
            j = (i + 1) % n
            faces += [(i, j, n + j), (i, n + j, n + i)]
        self.mesh(points, faces, color)

    def box(self, center, size, color):
        x, y, z = np.asarray(center) - np.asarray(size) / 2
        w, h, d = size
        self.prism([(x, y, z), (x, y, z + d), (x + w, y, z + d), (x + w, y, z)], (0, h, 0), color)

    def rod(self, start, end, radius, color, tip=None, sides=16):
        start, end = np.asarray(start), np.asarray(end)
        axis = (end - start) / np.linalg.norm(end - start)
        ref = (1, 0, 0) if abs(axis[0]) < 0.8 else (0, 1, 0)
        u = np.cross(ref, axis)
        u /= np.linalg.norm(u)
        v = np.cross(axis, u)
        ring = np.array([u * math.cos(t) + v * math.sin(t) for t in np.linspace(0, 2 * math.pi, sides, endpoint=False)])
        if tip is None:
            self.prism(start + radius * ring, end - start, color)
        else:
            points = np.concatenate([start + radius * ring, end + tip * ring])
            faces = [(0, i + 1, i) for i in range(1, sides - 1)]
            faces += [(sides, sides + i, sides + i + 1) for i in range(1, sides - 1)]
            for i in range(sides):
                j = (i + 1) % sides
                faces += [(i, j, sides + j), (i, sides + j, sides + i)]
            self.mesh(points, faces, color)

    def texture(self, points, image):
        self.mesh(points, [(0, 1, 2), (0, 2, 3)], WHITE, image, [(0, 1), (1, 1), (1, 0), (0, 0)])

    def sphere(self, center, radii, color):
        sphere(self, center, radii, color)

    def label(self, points, text, background, foreground=WHITE):
        self.texture(points, graphic(text, "rect", background, foreground))

    def export(self):
        """Mesh parts become glTF primitives with embedded PNG sign faces."""
        doc = {"asset": {"version": "2.0", "generator": "Scendance icon prop generator"}, "scene": 0,
               "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}], "meshes": [{"primitives": []}],
               "buffers": [], "bufferViews": [], "accessors": [], "materials": []}
        binary = bytearray()
        all_points = np.concatenate([part[0] for part in self.parts])
        lower, upper = np.min(all_points, axis=0), np.max(all_points, axis=0)
        pivot = (lower + upper) / 2
        pivot[1] = lower[1]

        def view(data, target=None):
            info = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
            if target:
                info["target"] = target
            binary.extend(data)
            binary.extend(bytes(-len(binary) % 4))
            doc["bufferViews"].append(info)
            return len(doc["bufferViews"]) - 1

        def accessor(rows, dtype, component, shape, target):
            array = np.asarray(rows, dtype=dtype)
            info = {"bufferView": view(array.tobytes(), target), "componentType": component,
                    "count": len(array), "type": shape}
            if shape == "VEC3":
                info["min"], info["max"] = array.min(axis=0).tolist(), array.max(axis=0).tolist()
            doc["accessors"].append(info)
            return len(doc["accessors"]) - 1

        # Batch opaque parts by material to keep complex props to a few draw calls.
        opaque = {}
        textured = []
        for points, faces, color, image, uv in self.parts:
            if image:
                textured.append((points, faces, color, image, uv))
                continue
            point_batches, face_batches = opaque.setdefault(color, ([], []))
            point_batches.append(points)
            face_batches.append(np.asarray(faces))
        parts = []
        for color, (point_batches, face_batches) in opaque.items():
            base = 0
            offset_faces = []
            for points, faces in zip(point_batches, face_batches):
                offset_faces.append(faces + base)
                base += len(points)
            parts.append((np.concatenate(point_batches), np.concatenate(offset_faces), color, None, None))
        parts.extend(textured)

        material_ids = {}
        triangles = 0
        for points, faces, color, image, uv in parts:
            triangles += len(faces)
            positions = accessor(points - pivot, "<f4", 5126, "VEC3", 34962)
            wide_indices = len(points) > 65535
            indices = accessor(np.asarray(faces).ravel(), "<u4" if wide_indices else "<u2",
                               5125 if wide_indices else 5123, "SCALAR", 34963)
            key = (color, id(image))
            if key not in material_ids:
                channels = [(v / 255 / 12.92 if v < 11 else ((v / 255 + 0.055) / 1.055) ** 2.4) for v in rgb(color)]
                pbr = {"baseColorFactor": [*channels, 1], "metallicFactor": 0.05, "roughnessFactor": 0.77}
                mat = {"pbrMetallicRoughness": pbr, "doubleSided": True}
                if image:
                    from io import BytesIO
                    png = BytesIO()
                    image.save(png, format="PNG", optimize=True)
                    images = doc.setdefault("images", [])
                    textures = doc.setdefault("textures", [])
                    images.append({"bufferView": view(png.getvalue()), "mimeType": "image/png"})
                    textures.append({"source": len(images) - 1})
                    pbr["baseColorFactor"] = [1, 1, 1, 1]
                    pbr["baseColorTexture"] = {"index": len(textures) - 1}
                    mat["alphaMode"] = "MASK"
                material_ids[key] = len(doc["materials"])
                doc["materials"].append(mat)
            attrs = {"POSITION": positions}
            if uv:
                attrs["TEXCOORD_0"] = accessor(uv, "<f4", 5126, "VEC2", 34962)
            doc["meshes"][0]["primitives"].append({"attributes": attrs, "indices": indices, "material": material_ids[key]})
        doc["buffers"].append({"byteLength": len(binary)})
        meta = json.dumps(doc, separators=(",", ":")).encode()
        meta += b" " * (-len(meta) % 4)
        glb = struct.pack("<4sII", b"glTF", 2, 28 + len(meta) + len(binary))
        glb += struct.pack("<I4s", len(meta), b"JSON") + meta
        glb += struct.pack("<I4s", len(binary), b"BIN\0") + binary
        return glb, (upper - lower).round(6).tolist(), triangles

    def preview(self, path):
        """Render the same mesh to an orthographic catalogue thumbnail."""
        direction = np.array([0.40, 0.40, 1.0])
        direction /= np.linalg.norm(direction)
        right = np.cross((0, 1, 0), direction)
        right /= np.linalg.norm(right)
        up = np.cross(direction, right)
        transform = np.array([right, -up, direction]).T
        projected = [points @ transform for points, *_ in self.parts]
        xy = np.concatenate(projected)[:, :2]
        low, high = xy.min(axis=0), xy.max(axis=0)
        scale = 214 / max(high - low)
        center = (low + high) / 2
        objects = []
        for points, (world, faces, color, texture, _) in zip(projected, self.parts):
            pixels = (points[:, :2] - center) * scale + 136
            if texture:
                objects.append((points[:, 2].max(), pixels, color, texture))
                continue
            for face in faces:
                idx = list(face)
                a, b, c = world[idx]
                normal = np.cross(b - a, c - a)
                normal /= max(np.linalg.norm(normal), 1e-9)
                light = 0.62 + 0.38 * abs(np.dot(normal, (0.35, 0.85, 0.4)))
                fill = tuple(min(255, round(channel * light)) for channel in rgb(color))
                objects.append((points[idx, 2].mean(), pixels[idx], fill, None))
        canvas = Image.new("RGB", (272, 272), "#e8eeed")
        draw = ImageDraw.Draw(canvas)
        for _, pixels, fill, texture in sorted(objects, key=lambda obj: obj[0]):
            if texture:
                a, b, _, d = pixels
                source = np.linalg.inv(np.column_stack(((b - a) / texture.width, (d - a) / texture.height)))
                offset = -source @ a
                affine = (*source[0], offset[0], *source[1], offset[1])
                warped = texture.convert("RGBA").transform(canvas.size, Image.Transform.AFFINE, affine, Image.Resampling.BICUBIC)
                canvas.paste(warped, mask=warped.getchannel("A"))
            else:
                draw.polygon([tuple(xy) for xy in pixels], fill=fill)
        canvas.resize((256, 256), Image.Resampling.LANCZOS).save(path, "WEBP", quality=88)


def graphic(text, shape, background, foreground):
    image = Image.new("RGBA", (512, 512))
    draw = ImageDraw.Draw(image)
    if shape == "circle":
        draw.ellipse((2, 2, 509, 509), fill=background, outline=WHITE, width=13)
    elif shape == "octagon":
        polygon = [(150, 3), (362, 3), (509, 150), (509, 362), (362, 509), (150, 509), (3, 362), (3, 150)]
        draw.polygon(polygon, fill=background)
        draw.line([*polygon, polygon[0]], fill=WHITE, width=13, joint="curve")
    elif shape == "triangle":
        draw.polygon([(256, 3), (509, 506), (3, 506)], fill=RED)
        draw.polygon([(256, 60), (460, 476), (52, 476)], fill=WHITE)
        foreground = DARK
    else:
        draw.rounded_rectangle((2, 2, 509, 509), 19, fill=background, outline=WHITE, width=12)
    if text == "@NATIONAL-SPEED-LIMIT":
        draw.polygon([(71, 381), (379, 68), (442, 132), (132, 444)], fill=DARK)
    elif text == "NO ENTRY":
        draw.rounded_rectangle((87, 216, 425, 296), 12, fill=WHITE)
    elif text in ("@LEFT", "@RIGHT", "@UP"):
        arrow = [(96, 256), (252, 102), (252, 183), (425, 183), (425, 329), (252, 329), (252, 410)]
        if text == "@RIGHT":
            arrow = [(512 - x, y) for x, y in arrow]
        if text == "@UP":
            arrow = [(y, x) for x, y in arrow]
        draw.polygon(arrow, fill=foreground)
    else:
        lines = text.split("/")
        size = 146 if len(lines) == 1 else 104
        max_width = 362 if shape in ("triangle", "circle") else 452
        while max(draw.textlength(line, font=font(size)) for line in lines) > max_width and size > 22:
            size -= 3
        for i, line in enumerate(lines):
            y = (306 if shape == "triangle" else 256) + (i - (len(lines) - 1) / 2) * size * 1.22
            draw.text((256, y), line, anchor="mm", font=font(size), fill=foreground, align="center")
    return image


def sign(prop, text, shape="rect", color=BLUE, ink=WHITE, portable=False):
    width = 0.84
    height = 0.70 if shape == "rect" else width
    top = 1.05 if portable else 2.0
    center = top - height / 2
    panel_z = 0.045
    prop.box((0, 0.04, 0), (0.42, 0.08, 0.40), DARK)
    prop.rod((0, 0.04, 0), (0, top - 0.10, 0), 0.035, METAL)
    outline = {
        "circle": [(math.cos(t) * 0.5, math.sin(t) * 0.5) for t in np.linspace(0, 2 * math.pi, 32, endpoint=False)],
        "triangle": [(-0.5, -0.5), (0.5, -0.5), (0, 0.5)],
        "octagon": [(-0.5, -0.21), (-0.21, -0.5), (0.21, -0.5), (0.5, -0.21),
                    (0.5, 0.21), (0.21, 0.5), (-0.21, 0.5), (-0.5, 0.21)],
        "rect": [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)],
    }[shape]
    prop.prism([(x * width, center + y * height, panel_z) for x, y in outline], (0, 0, 0.024), color)
    prop.texture([(-width / 2, center - height / 2, 0.071), (width / 2, center - height / 2, 0.071),
                  (width / 2, center + height / 2, 0.071), (-width / 2, center + height / 2, 0.071)],
                 graphic(text, shape, color, ink))


# Entry is the exact sign message; the structure is rendered at a usable site-plan scale.
SIGNS = {
    "emergency-access-point": ("EMERGENCY/ACCESS", "rect", RED),
    "evacuation-meeting-point": ("ASSEMBLY/POINT", "rect", GREEN),
    "pedestrian-access": ("PEDESTRIAN/ACCESS", "rect", GREEN),
    "vehicle-access": ("VEHICLE/ACCESS", "rect", BLUE),
    "information-point": ("i/INFORMATION", "rect", BLUE),
    "lost-property": ("LOST &/FOUND", "rect", BLUE),
    "missing-persons-point": ("MISSING/PERSONS", "rect", BLUE),
    "wristband-collection": ("WRISTBAND/PICKUP", "rect", BLUE),
    "welfare-point": ("WELFARE/POINT", "rect", BLUE),
    "load-zone": ("LOADING/ZONE", "rect", BLUE),
    "park-and-ride": ("P + R", "rect", BLUE),
    "cycle-parking": ("CYCLE/PARKING", "rect", BLUE),
    "km-marker": ("KM", "rect", BLUE),
    "5km": ("5 KM", "rect", BLUE),
    "parking": ("P", "rect", BLUE),
    "car-park-closed": ("CAR PARK/CLOSED", "rect", RED),
    "national-speed-limit": ("@NATIONAL-SPEED-LIMIT", "circle", WHITE),
    "stop": ("STOP", "octagon", RED),
    "go": ("GO", "circle", GREEN),
    "no-entry": ("NO ENTRY", "circle", RED),
    "no-parking": ("NO/PARKING", "circle", RED),
    "no-u-turn": ("NO/U TURN", "circle", RED),
    "danger": ("!", "triangle", WHITE),
    "hazard": ("HAZARD", "triangle", WHITE),
    "bumps": ("BUMPS", "triangle", WHITE),
    "flood": ("FLOOD", "triangle", WHITE),
    "lollypop-crossing": ("STOP", "circle", RED),
    "merge": ("MERGE", "triangle", WHITE),
    "queues": ("QUEUES", "triangle", WHITE),
    "road-narrows": ("ROAD/NARROWS", "triangle", WHITE),
    "roadworks": ("ROAD/WORKS", "triangle", WHITE),
    "school-children": ("SCHOOL", "triangle", WHITE),
    "slippery": ("SLIPPERY", "triangle", WHITE),
    "towaway": ("TOW/AWAY", "rect", WHITE, DARK),
    "detour": ("DETOUR", "rect", GOLD, DARK),
    "diversion": ("DIVERSION", "rect", GOLD, DARK),
    "reduce-speed-now": ("REDUCE/SPEED", "rect", RED),
    "road-ahead-closed": ("ROAD AHEAD/CLOSED", "rect", RED),
    "road-closed": ("ROAD/CLOSED", "rect", RED),
    "straight": ("@UP", "circle", BLUE),
    "turn-left": ("@LEFT", "circle", BLUE),
    "turn-right": ("@RIGHT", "circle", BLUE),
    "traffic-lights-ahead": ("SIGNALS/AHEAD", "triangle", WHITE),
    "aid-station-200m": ("AID/200 m", "rect", BLUE),
    "penalty-box-200m": ("PENALTY/200 m", "rect", BLUE),
    "repair-200m": ("REPAIR/200 m", "rect", BLUE),
    "littering-start": ("LITTER ZONE/START", "rect", GOLD, DARK),
    "littering-end": ("LITTER ZONE/END", "rect", GOLD, DARK),
    "no-aero-start": ("NO AERO/START", "rect", GOLD, DARK),
    "no-aero-end": ("NO AERO/END", "rect", GOLD, DARK),
    "no-draft-start": ("NO DRAFT/START", "rect", GOLD, DARK),
    "no-draft-end": ("NO DRAFT/END", "rect", GOLD, DARK),
    "bike-in": ("BIKE IN", "rect", BLUE),
    "bike-out": ("BIKE OUT", "rect", BLUE),
    "run-out": ("RUN OUT", "rect", BLUE),
    "swim-in": ("SWIM IN", "rect", BLUE),
    "swim-out": ("SWIM OUT", "rect", BLUE),
    "p1": ("P1", "rect", BLUE),
    "p2": ("P2", "rect", BLUE),
    "p3": ("P3", "rect", BLUE),
    "p4": ("P4", "rect", BLUE),
}


def trackway(prop, color, width, depth, pattern):
    prop.box((0, 0.028, 0), (width, 0.056, depth), color)
    for i in range(-4, 5):
        z = i * depth / 10
        if pattern == "rib":
            prop.box((0, 0.060, z), (width * 0.94, 0.008, 0.045), DARK)
        else:
            for j in range(-5, 6):
                x = (j + (i % 2) * 0.4) * width / 12
                prop.box((x, 0.060, z), (0.05, 0.009, 0.024), WHITE if color == METAL else DARK)


def wickets(prop, training):
    base = 0.06 if training else 0
    if training:
        prop.box((0, base / 2, 0), (0.33, base, 0.17), DARK)
    for x in (-0.10, 0, 0.10):
        prop.rod((x, base, 0), (x, base + 0.71, 0), 0.018, GOLD if training else WOOD)
    for x in (-0.10, 0):
        prop.rod((x + 0.016, base + 0.721, 0), (x + 0.084, base + 0.721, 0), 0.011, WHITE)


def lantern(prop, with_riddle):
    levels = ((0.13, 0.12), (0.23, 0.25), (0.40, 0.30), (0.57, 0.25), (0.67, 0.12))
    for (y, radius), (next_y, tip) in zip(levels, levels[1:]):
        prop.rod((0, y, 0), (0, next_y, 0), radius, RED, tip=tip, sides=24)
        for θ in np.linspace(0, 2 * math.pi, 12, endpoint=False):
            x, z = math.cos(θ), math.sin(θ)
            prop.rod((radius * x, y, radius * z), (tip * x, next_y, tip * z), 0.006, "#a91f25")
    for y in (0.10, 0.67):
        prop.rod((0, y, 0), (0, y + 0.04, 0), 0.125, GOLD)
    prop.rod((0, 0.71, 0), (0, 0.82, 0), 0.015, RED)
    for x in (-0.028, -0.014, 0, 0.014, 0.028):
        prop.rod((x / 2, 0.10, 0), (x, 0, 0), 0.004, GOLD)
    if with_riddle:
        prop.box((0.13, 0.17, 0.30), (0.17, 0.25, 0.012), GOLD)
        prop.texture([(0.05, 0.07, 0.307), (0.21, 0.07, 0.307), (0.21, 0.28, 0.307), (0.05, 0.28, 0.307)],
                     graphic("?", "rect", GOLD, DARK))


def paper_fan(prop):
    from math import cos, sin
    radius = 0.19
    prop.rod((0, 0, 0), (0, 0.25, 0), 0.014, WOOD)
    for i in range(16):
        a = i * math.tau / 16
        b = (i + 1) * math.tau / 16
        prop.prism([(0, 0.32, 0), (radius * cos(a), 0.32 + radius * sin(a), 0),
                    (radius * cos(b), 0.32 + radius * sin(b), 0)], (0, 0, 0.009),
                   WHITE if i % 2 else "#efc9af")
        prop.rod((0, 0.32, 0.014), (radius * cos(a), 0.32 + radius * sin(a), 0.014), 0.002, WOOD)


def firecracker(prop, bundle):
    for i in range(12 if bundle else 1):
        x = (i % 4 - 1.5) * 0.055 if bundle else 0
        z = (i // 4 - 1) * 0.055 if bundle else 0
        h = 0.18 + (i % 3) * 0.017 if bundle else 0.36
        prop.rod((x, 0, z), (x, h, z), 0.025 if bundle else 0.07, RED)
        for y in (0.012, h - 0.024):
            prop.rod((x, y, z), (x, y + 0.013, z), 0.026 if bundle else 0.071, GOLD)
        prop.rod((x, h, z), (x + 0.015, h + 0.025, z), 0.004, DARK)


def tanghulu(prop):
    from math import sqrt
    prop.rod((0, 0, 0), (0, 0.32, 0), 0.0035, WOOD)
    for y in (0.11, 0.157, 0.204, 0.251):
        for i in range(8):
            a, b = i / 4 - 1, (i + 1) / 4 - 1
            r0 = max(0.0003, 0.024 * sqrt(1 - a*a))
            r1 = max(0.0003, 0.024 * sqrt(1 - b*b))
            prop.rod((0, y + a*0.024, 0), (0, y + b*0.024, 0), r0, "#b42524", tip=r1, sides=12)


def mooncake(prop):
    radius = 0.055
    ring = []
    for i in range(96):
        angle = i * math.tau / 96
        r = radius * (0.97 + 0.03 * math.cos(angle * 24))
        ring.append((r * math.cos(angle), 0, -r * math.sin(angle)))
    prop.prism(ring, (0, 0.034, 0), "#b7652b")
    prop.rod((0, 0.034, 0), (0, 0.037, 0), 0.037, "#dc9845", sides=32)
    for angle in np.linspace(0, math.tau, 12, endpoint=False):
        x, z = 0.033 * math.cos(angle), 0.033 * math.sin(angle)
        prop.rod((x, 0.037, z), (x, 0.042, z), 0.008, "#bb752f", sides=12)


def zongzi(prop):
    a, b, c, d = (-.062, 0, -.035), (.065, 0, -.035), (0, 0, .067), (0, .09, 0)
    prop.mesh([a, b, c, d], [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)], "#53774b")
    for p, q in [((-.06, .006, -.026), (0, .082, .001)), ((0, .082, .001), (.035, .006, .041)),
                 ((.056, .008, -.028), (-.024, .055, .021)), ((-.024, .055, .021), (-.027, .006, .050))]:
        prop.rod(p, q, .0024, "#d0b981")


def red_envelope(prop):
    prop.box((0, .087, 0), (.09, .174, .008), RED)
    prop.mesh([(-.044, .173, .005), (.044, .173, .005), (0, .113, .005)], [(0, 2, 1)], "#e44835")
    prop.rod((0, .085, .004), (0, .085, .006), .016, GOLD)


def sphere(prop, center, radii, color, bands=10, sides=16):
    x, y, z = center
    rx, ry, rz = radii
    points = [(x, y + ry, z)]
    for band in range(1, bands):
        latitude = math.pi * band / bands
        for side in range(sides):
            longitude = math.tau * side / sides
            points.append((x + rx * math.sin(latitude) * math.cos(longitude),
                           y + ry * math.cos(latitude),
                           z + rz * math.sin(latitude) * math.sin(longitude)))
    points.append((x, y - ry, z))
    faces = [(0, 1 + side, 1 + (side + 1) % sides) for side in range(sides)]
    for band in range(bands - 2):
        start = 1 + band * sides
        for side in range(sides):
            a = start + side
            b = start + (side + 1) % sides
            faces += [(a, a + sides, b), (b, a + sides, b + sides)]
    last = 1 + (bands - 2) * sides
    faces += [(len(points) - 1, last + (side + 1) % sides, last + side) for side in range(sides)]
    prop.mesh(points, faces, color)


def arch(prop, mode):
    width = 3.8
    if mode == "truss":
        posts = [(-1.9, 0), (-1.9, 3.2), (1.9, 3.2), (1.9, 0)]
        for a, b in zip(posts, posts[1:]):
            ax, ay = a
            bx, by = b
            for z in (-0.18, 0.18):
                prop.rod((ax, ay, z), (bx, by, z), .043, METAL)
            for i in range(8):
                x0, y0 = ax + (bx-ax)*i/8, ay + (by-ay)*i/8
                x1, y1 = ax + (bx-ax)*(i+1)/8, ay + (by-ay)*(i+1)/8
                prop.rod((x0, y0, -0.18), (x0, y0, 0.18), .026, METAL)
                prop.rod((x0, y0, (-1)**i*.18), (x1, y1, (-1)**(i+1)*.18), .022, METAL)
        for x in (-1.9, 1.9):
            prop.box((x, .038, 0), (.50, .076, .64), DARK)
        return
    path = [(-width/2, 0), (-width/2, 1.2)]
    path += [(-width/2*math.cos(t), 1.2+1.7*math.sin(t))
             for t in np.linspace(0, math.pi, 21)[1:-1]]
    path += [(width/2, 1.2), (width/2, 0)]
    if mode == "balloon":
        for i, (a, b) in enumerate(zip(path, path[1:])):
            segments = 5 if i in (0, len(path)-2) else 1
            for j in range(segments):
                x, y = [u+(v-u)*j/segments for u,v in zip(a,b)]
                for k, z in enumerate((-.17, .17)):
                    sphere(prop, (x + .08*(-1)**k, max(y, .16), z), (.19, .20, .19),
                           [RED, GOLD, "#9ac9df", WHITE][(i+j+k)%4], 7, 12)
        return
    for a, b in zip(path, path[1:]):
        prop.rod((*a, 0), (*b, 0), .30, BLUE, sides=12)
    for x, y in path[1:-1]:
        sphere(prop, (x,y,0), (.30,.30,.30), BLUE, 6, 12)
    for x in (-width/2,width/2):
        prop.rod((x, 0, 0), (x, .61, 0), .303, GOLD)
    prop.box((0, 2.65, .10), (1.30, .38, .40), BLUE)


def bouncer(prop):
    prop.box((0, .26, 0), (3.6, .52, 3.7), BLUE)
    for x in np.linspace(-1.54, 1.54, 9):
        prop.rod((x, .48, -1.67), (x, .48, 1.67), .19, "#5ba0da")
    for x in (-1.65, 1.65):
        for z in (-1.65, 1.65):
            prop.rod((x, .38, z), (x, 2.42, z), .29, GOLD)
            prop.rod((x, 2.38, z), (x, 3.05, z), .34, RED, tip=.012)
            prop.rod((x, 3.02, z), (x, 3.26, z), .018, METAL)
            prop.prism([(x, 3.24, z), (x, 3.06, z), (x + .35, 3.17, z)], (0,0,.015), RED)
    for x in (-1.68,1.68):
        for y in (.76,2.0):
            prop.rod((x,y,-1.62),(x,y,1.62), .145, GOLD)
        for z in np.linspace(-1.5,1.5,24):
            prop.rod((x,.78,z),(x,1.98,z), .006, DARK, sides=5)
    for y in (.77,2.03):
        prop.rod((-1.64,y,-1.67),(1.64,y,-1.67),.14,RED)
    for x in np.linspace(-1.52,1.52,25):
        prop.rod((x,.82,-1.67),(x,1.95,-1.67),.006,DARK,sides=5)
    prop.box((0,.20,2.0),(1.25,.40,.75),RED)


def shelter(prop, kind):
    if kind in ("yurt", "dome"):
        radius = 2.7
        segments = 24
        shell = "#f5dfac" if kind == "yurt" else "#c5d9e0"
        heights = [(0, 2.7), (2.03, 2.7), (3.13, .38)] if kind == "yurt" else [
            (0, 2.75), (1.32, 2.48), (2.47, 1.69), (3.05, .49), (3.12, .05)]
        rings = [[(r*math.cos(i*math.tau/segments),y,r*math.sin(i*math.tau/segments))
                  for i in range(segments)] for y,r in heights]
        for j, (lower, upper) in enumerate(zip(rings, rings[1:])):
            for i in range(segments):
                end = (i+1)%segments
                prop.mesh([lower[i],lower[end],upper[end],upper[i]], [(0,1,2),(0,2,3)], shell)
                if kind == "dome":
                    for a,b in [(lower[i],upper[i]),(lower[i],upper[end]),(upper[i],upper[end])]:
                        prop.rod(a,b,.018,METAL,sides=6)
        prop.box((0,1.01,radius-.02),(1.01,2.02,.13),WOOD if kind=="yurt" else DARK)
        if kind=="yurt":
            prop.rod((0,3.06,0),(0,3.24,0),.40,WOOD)
        return
    poles = [(-4,2.20,-2.6), (4,3.25,-2.6), (4,2.20,2.6), (-4,3.25,2.6)]
    for x,y,z in poles:
        prop.rod((x,0,z),(x,y,z),.046,METAL)
        prop.rod((x,y*.96,z),(x*1.18,0,z*1.21),.012,DARK)
    center = (0,3.5,0)
    for i,(a,b) in enumerate(zip(poles,poles[1:]+poles[:1])):
        middle = tuple((u+v)/2 for u,v in zip(a,b))
        middle = (middle[0]*.91,middle[1]+.07,middle[2]*.93)
        prop.mesh([a,middle,b,center],[(0,1,3),(1,2,3)], ["#d7ae7d","#e6c99f"][i%2])


def banner(prop, kind):
    if kind == "pull-up":
        prop.box((0,.04,0),(.94,.08,.29),METAL)
        prop.rod((0,.08,0),(0,2.1,0),.018,DARK)
        prop.box((0,1.085,.10),(.86,2.01,.012),BLUE)
        prop.box((0,2.105,.10),(.90,.025,.024),METAL)
        prop.box((0,1.42,.107),(.86,.32,.003),GOLD)
    elif kind == "feather":
        prop.box((0,.025,0),(.65,.05,.59),DARK)
        points = [(0,0,0),(0,2.47,0),(.12,2.85,0),(.45,2.91,0),(.76,2.73,0)]
        for a,b in zip(points,points[1:]):
            prop.rod(a,b,.025,DARK)
        prop.prism([(0,.52,0),(.76,.92,0),(.76,2.73,0),(.45,2.91,0),(.12,2.85,0),(0,2.47,0)],(0,0,.014),BLUE)
        prop.prism([(.04,.69,.016),(.73,1.08,.016),(.73,1.27,.016),(.04,.92,.016)],(0,0,.003),GOLD)
    else:
        prop.box((0,.04,0),(.40,.08,.40),DARK)
        prop.rod((0,0,0),(0,4.05,0),.073,METAL)
        prop.rod((0,4.04,0),(.53,4.04,0),.054,METAL)
        prop.box((.57,4.03,0),(.22,.10,.19),DARK)
        for y in (2.12,3.36):
            prop.rod((0,y,0),(.83,y,0),.024,DARK)
        prop.box((.47,2.74,0),(.64,1.22,.017),BLUE)
        prop.box((.47,3.02,.009),(.64,.22,.003),GOLD)


def sign_frame(prop, sides):
    for x in (-.59,.59):
        for z in (-.42,.42):
            prop.rod((x,.045,z),(x,1.94,z),.033,METAL)
            prop.box((x,.026,z),(.21,.052,.22),DARK)
    for end in (-1,1):
        prop.box((0,1.41,.42*end),(1.16,.72,.033),BLUE)
        for y in (1.04,1.78):
            prop.rod((-.59,y,.42*end),(.59,y,.42*end),.030,METAL)
        if sides==4:
            prop.box((.59*end,1.41,0),(.033,.72,.84),BLUE)
            for y in (1.04,1.78):
                prop.rod((.59*end,y,-.42),(.59*end,y,.42),.030,METAL)


def road_marking(prop):
    prop.box((0,.035,0),(4.2,.07,3.45),DARK)
    for x in np.linspace(-1.8,1.8,9):
        prop.box((x,.072,0),(.25,.009,1.84),WHITE)


def message_board(prop, mobile):
    if mobile:
        prop.box((0,.32,0),(1.75,.14,1.35),METAL)
        for x in (-.98,.98):
            prop.rod((x-.10,.23,0),(x+.10,.23,0),.23,DARK)
            prop.rod((x-.105,.23,0),(x+.105,.23,0),.11,METAL)
        prop.rod((-.59,.30,.48),(0,.30,1.20),.038,METAL)
        prop.rod((.59,.30,.48),(0,.30,1.20),.038,METAL)
    else:
        prop.box((0,.07,0),(1.94,.14,.66),DARK)
    for x in (-.78,.78):
        prop.rod((x,.14,0),(x,2.32,0),.052,METAL)
    prop.box((0,1.98,0),(2.03,.86,.14),DARK)
    image=graphic("EVENT/TRAFFIC","rect",DARK,GOLD)
    prop.texture([(-.94,1.60,.073),(.94,1.60,.073),(.94,2.36,.073),(-.94,2.36,.073)],image)


def refill_station(prop):
    prop.box((0,.57,0),(.51,1.14,.42),METAL)
    prop.box((0,.99,.127),(.36,.26,.18),DARK)
    prop.box((0,.845,.222),(.39,.032,.17),METAL)
    prop.rod((0,1.12,.22),(0,1.01,.22),.033,METAL)
    prop.box((0,.59,.214),(.44,.33,.012),BLUE)


def spot(prop, kind):
    prop.box((0, .76, 0), (1.86, .075, .72), WHITE)
    for x in (-.79,.79):
        for z in (-.28,.28):
            prop.rod((x,0,z),(x,.73,z),.022,METAL)
    if kind == "feed":
        for i in range(4):
            x=(i-1.5)*.36
            prop.box((x,.873,0),(.30,.15,.31),WOOD)
            for j in (-1,0,1):
                sphere(prop,(x+j*.056,.962,0),(.034,.032,.035),GOLD if i%2 else RED,6,8)
    else:
        for x in (-.60,.60):
            prop.box((x,.94,0),(.45,.29,.39),RED)
            prop.box((x,1.09,0),(.46,.03,.40),WHITE)
            prop.rod((x,.91,.19),(x,.91,.246),.022,DARK)
        for x in (-.25,0,.25):
            prop.rod((x,.797,0),(x,.891,0),.031,WHITE,tip=.042)


def envelope_tag(prop, kind):
    if kind == "wish":
        prop.box((0,.09,0),(.10,.18,.012),WOOD)
        prop.rod((-0.022,.18,0),(0,.23,0),.003,RED)
        prop.rod((0,.23,0),(.022,.18,0),.003,RED)
        for y in (.069,.089,.109):
            prop.box((0,y,.008),(.059,.002,.002),GOLD)
        return
    for x in (-.12,.12):
        prop.box((x,.29,0),(.091,.58,.013),RED)
        for y in (.12,.23,.34,.45):
            prop.rod((x,y,.008),(x,y,.010),.026,GOLD,sides=4)
    prop.box((0,.63,0),(.39,.085,.013),RED)
    for x in (-.10,0,.10):
        prop.rod((x,.63,.008),(x,.63,.010),.022,GOLD,sides=4)


def tangyuan(prop):
    for y, r0, r1 in [(0,.083,.084),(.024,.084,.121),(.05,.121,.145),(.065,.145,.146)]:
        prop.rod((0,y,0),(0,y+.018,0),r0,WHITE,tip=r1,sides=28)
    prop.rod((0,.066,0),(0,.069,0),.131,"#dabf99",sides=32)
    for x,z in ((-.053,.039),(.063,.021),(.037,-.053),(-.039,-.051),(0,0)):
        sphere(prop,(x,.080,z),(.028,.025,.028),WHITE,9,13)


def mugwort(prop):
    for i in range(6):
        angle=i*math.tau/6
        x,z=.055*math.cos(angle),.055*math.sin(angle)
        prop.rod((0,0,0),(x,.38,z),.0038,GREEN)
        for j in range(7):
            y=.106+j*.037
            radius=.034-.002*j
            for offset in (-1,1):
                sphere(prop,(x*y/.38+offset*radius*.58,y,z*y/.38), (radius,.004,.013), "#688b60",5,10)
    prop.rod((0,.049,0),(0,.064,0),.023,GOLD)


def dragon_boat(prop):
    rings=[]
    for z,w,h in [(-3.7,.055,.45),(-3.15,.34,.31),(-2.35,.64,.28),(0,.74,.27),(2.35,.63,.29),(3.07,.34,.38),(3.64,.07,.52)]:
        rings.append([(-w,h,z),(-w*.75,max(0,h-.24),z),(w*.75,max(0,h-.24),z),(w,h,z)])
    for lower,upper in zip(rings,rings[1:]):
        for i in range(3):
            prop.mesh([lower[i],lower[i+1],upper[i+1],upper[i]],[(0,1,2),(0,2,3)],RED)
        for i in (0,3):
            prop.rod(lower[i],upper[i],.035,GOLD,sides=12)
    for z in np.linspace(-2.4,2.4,8):
        prop.box((0,.23,z),(1.10 if abs(z)<2 else .91,.035,.142),WOOD)
    sphere(prop,(0,.71,3.37),(.17,.21,.24),GREEN)
    sphere(prop,(0,.64,3.61),(.18,.102,.25),RED)
    for x in (-.154,.154):
        sphere(prop,(x,.77,3.49),(.041,.047,.049),WHITE,7,12)
        sphere(prop,(x*1.15,.77,3.52),(.016,.023,.024),DARK,7,10)
        prop.rod((x*.78,.83,3.30),(x*1.75,1.02,3.18),.025,GOLD,tip=.008)
    prop.rod((0,.46,-3.47),(0,.76,-3.80),.10,RED,tip=.025)
    prop.rod((0,.29,2.66),(0,.49,2.66),.185,RED)
    prop.rod((0,.49,2.66),(0,.51,2.66),.175,WHITE)


def opera_stage(prop):
    prop.box((0,.33,0),(5.80,.66,4.10),WOOD)
    prop.box((0,.68,0),(5.87,.075,4.12),RED)
    for x in (-2.62,2.62):
        for z in (-1.73,1.73):
            prop.rod((x,.73,z),(x,3.43,z),.095,RED)
            prop.rod((x,.70,z),(x,.85,z),.13,GOLD)
    prop.box((0,2.03,-1.61),(5.29,2.54,.096),"#812436")
    for i in range(32):
        x=-2.58+i*.165
        prop.rod((x,.76,-1.56),(x,3.28,-1.56),.035,RED,sides=8)
    for end in (-1,1):
        ring=[(-3.20,3.47,2.22*end),(-2.65,3.24,2.05*end),(2.65,3.24,2.05*end),(3.20,3.47,2.22*end),
              (2.77,4.15,0),(-2.77,4.15,0)]
        prop.mesh(ring,[(0,1,5),(1,4,5),(1,2,4),(2,3,4)],"#446571")
        for x in np.linspace(-2.68,2.68,22):
            prop.rod((x,3.29,2.06*end),(x,4.16,0),.024,"#577583",sides=7)
        prop.rod((-3.2,3.47,2.22*end),(-2.65,3.25,2.05*end),.036,GOLD)
        prop.rod((3.2,3.47,2.22*end),(2.65,3.25,2.05*end),.036,GOLD)
    prop.rod((-2.93,4.16,0),(2.93,4.16,0),.051,GOLD)
    for j in range(3):
        height=.17*(j+1)
        prop.box((0,height/2,2.87-j*.31),(1.26,height,.35),WOOD)


def cricket_targets(prop):
    prop.box((0,.035,0),(2.15,.07,.45),METAL)
    prop.box((0,.41,-.02),(2.03,.67,.052),WHITE)
    for i in range(5):
        x=(i-2)*.36
        prop.rod((x,.46,.007),(x,.46,.021),.112,DARK)
        prop.rod((x,.46,.022),(x,.46,.026),.042,WHITE)
    prop.box((0,.08,.09),(1.92,.04,.22),GREEN)


def network_wall(prop, kind):
    prop.box((0,.19,0),(.44,.38,.22),WHITE)
    if kind=="wifi":
        prop.box((0,.24,.113),(.36,.06,.008),BLUE)
        for x in (-.13,.13):
            prop.rod((x,.36,0),(x,.65,0),.018,DARK)
    else:
        for x in (-.11,.11):
            prop.box((x,.18,.114),(.132,.130,.009),DARK)
            for i in range(6):
                prop.box((x+(i-2.5)*.014,.21,.12),(.009,.018,.003),GOLD)


def charity_display(prop):
    prop.box((0,.08,0),(.32,.16,.21),BLUE)
    prop.box((0,.189,0),(.34,.06,.22),BLUE)
    prop.box((0,.220,.015),(.09,.003,.009),DARK)
    prop.box((0,.12,.107),(.28,.10,.008),WHITE)
    prop.box((0,.311,-.081),(.31,.184,.014),BLUE)
    prop.texture([(-.15,.225,-.072),(.15,.225,-.072),(.15,.394,-.072),(-.15,.394,-.072)],
                 graphic("DONATE","rect",BLUE,WHITE))


def wheel(prop, x, y, z, radius, tire):
    prop.rod((x-.085,y,z),(x+.085,y,z),radius,tire,sides=24)
    prop.rod((x-.091,y,z),(x+.091,y,z),radius*.48,METAL,sides=16)


def chuck_wagon(prop):
    prop.box((0,.78,0),(1.52,.21,3.06),WOOD)
    for x in (-.78,.78):
        prop.box((x,1.006,0),(.078,.35,2.99),WOOD)
        for z in (-1.05,1.13):
            radius=.54 if z>0 else .43
            sign_x=1 if x>0 else -1
            wx=x+sign_x*.19
            for i in range(20):
                a,b=i*math.tau/20,(i+1)*math.tau/20
                p=(wx,radius+radius*math.cos(a),z+radius*math.sin(a))
                q=(wx,radius+radius*math.cos(b),z+radius*math.sin(b))
                prop.rod(p,q,.034,DARK,sides=7)
                if i%2==0:
                    prop.rod((wx,radius,z),p,.026,WOOD,sides=6)
            prop.rod((x,radius,z),(wx+sign_x*.062,radius,z),.082,WOOD)
    for i in range(14):
        a,b=i*math.pi/14,(i+1)*math.pi/14
        x,y=.82*math.cos(a),1.13+1.02*math.sin(a)
        xx,yy=.82*math.cos(b),1.13+1.02*math.sin(b)
        prop.mesh([(x,y,-1.40),(xx,yy,-1.40),(xx,yy,1.22),(x,y,1.22)],[(0,1,2),(0,2,3)],
                  "#e7d2a7" if i%2 else "#ddc69b")
        for z in (-1.40,-.45,.43,1.22):
            prop.rod((x,y,z),(xx,yy,z),.020,WOOD,sides=7)
    prop.box((0,.98,1.50),(1.43,.50,.38),WOOD)
    prop.box((0,1.18,1.91),(1.39,.057,.52),WOOD)
    for x in (-.46,.27):
        prop.rod((x,1.21,1.9),(x,1.35,1.9),.148,DARK)
        prop.rod((x,1.35,1.9),(x,1.38,1.9),.16,METAL)
    prop.rod((0,.62,-1.1),(0,.59,-2.35),.052,WOOD)


def round_dining(prop):
    prop.rod((0,.025,0),(0,.074,0),.31,DARK)
    prop.rod((0,.07,0),(0,.704,0),.058,METAL)
    prop.rod((0,.70,0),(0,.75,0),.71,WOOD,sides=32)
    for i in range(6):
        t=i*math.tau/6
        local=Prop()
        local.box((0,.465,1.0),(.45,.062,.43),WOOD)
        local.box((0,.745,1.205),(.42,.238,.058),WOOD)
        for x in (-.175,.175):
            for z in (.835,1.169):
                local.rod((x,0,z),(x,.46 if z<1 else .85,z),.019,METAL)
        rotation=np.array([[math.cos(t),0,math.sin(t)],[0,1,0],[-math.sin(t),0,math.cos(t)]])
        for points,faces,color,image,uv in local.parts:
            prop.mesh(points@rotation,faces,color,image,uv)


def portable_wc(prop, variant):
    accessible=variant=="accessible"
    w,d=(1.67,1.63) if accessible else (1.24,1.29)
    shell=BLUE if accessible else GREEN
    prop.box((0,.075,0),(w,.15,d),DARK)
    prop.box((0,1.12,-d/2+.045),(w,2.10,.09),shell)
    for x in (-w/2+.047,w/2-.047):
        prop.box((x,1.12,0),(.094,2.10,d),shell)
        for i in range(5):
            prop.box((x*1.05,1.08,(i-2)*d/6),(.034,1.83,.07),shell)
    prop.box((0,2.197,0),(w+.065,.12,d+.065),WHITE)
    prop.box((0,1.14,d/2-.039),(w-.19,1.97,.077),shell)
    prop.rod((w*.33,1.03,d/2+.015),(w*.33,1.22,d/2+.015),.020,METAL)
    text="ACCESSIBLE/WC" if accessible else "ALL GENDER/WC"
    prop.texture([(-.26,1.58,d/2+.002),(.26,1.58,d/2+.002),(.26,1.96,d/2+.002),(-.26,1.96,d/2+.002)],
                 graphic(text,"rect",WHITE,DARK))


def access_ramp(prop, turn=False):
    prop.box((0,.57,-1.27),(1.35,.14,1.28),METAL)
    x0,z0,y0=(0,-.66,.56)
    x1,z1,y1=(0,4.5,0)
    if turn:
        # Side entry connects to the landing at 90 degrees.
        x0,z0,x1,z1,y0,y1=-.64,-1.27,-4.80,-1.27,.56,0
    length=math.hypot(x1-x0,z1-z0)
    side=np.array([(z1-z0)/length,0,-(x1-x0)/length])*.62
    a,b=np.array([x0,y0,z0]),np.array([x1,y1,z1])
    prop.prism([a-side,b-side,b+side,a+side],(0,.064,0),METAL)
    for s in (-side,side):
        prop.rod(a+s+np.array([0,.95,0]),b+s+np.array([0,.95,0]),.023,BLUE)
        for t in (0,.33,.66,1):
            p=a*(1-t)+b*t+s
            prop.rod(p,p+np.array([0,.95,0]),.022,METAL)
    for x in (-.62,.62):
        prop.rod((x,.56,-1.85),(x,1.50,-1.85),.022,METAL)
    prop.rod((-.62,1.50,-1.85),(.62,1.50,-1.85),.023,BLUE)


def evacuation_chair(prop):
    prop.box((0,.72,-.02),(.45,.05,.36),RED)
    prop.box((0,1.025,-.24),(.44,.39,.065),RED)
    for x in (-.23,.23):
        prop.rod((x,.20,-.17),(x,1.25,-.24),.019,METAL)
        prop.rod((x,1.23,-.24),(x,1.23,-.43),.019,METAL)
        prop.rod((x,.19,-.17),(x,.04,.25),.034,DARK)
        prop.rod((x,.72,.12),(x,.26,.27),.022,METAL)
        wheel(prop,x,.18,-.16,.153,DARK)
        wheel(prop,x,.088,.26,.087,DARK)
    prop.rod((-.21,.48,.256),(.21,.48,.256),.020,METAL)
    prop.box((0,.77,.04),(.46,.027,.055),DARK)


def jade_rabbit(prop):
    jade="#73a98a"
    sphere(prop,(0,.08,0),(.061,.068,.064),jade)
    sphere(prop,(0,.139,.034),(.040,.043,.043),jade)
    sphere(prop,(0,.064,-.059),(.022,.022,.027),jade)
    for x in (-.022,.022):
        sphere(prop,(x,.190,.019),(.013,.062,.016),jade)
        sphere(prop,(x,.032,.041),(.021,.021,.031),jade)
    for x in (-.035,.035):
        sphere(prop,(x,.145,.054),(.005,.005,.006),GREEN,6,8)
    prop.rod((0,0,0),(0,.022,0),.082,WOOD,sides=20)


def chinese_knot(prop):
    for angle in (0,math.pi/2,math.pi,math.pi*1.5):
        center=np.array([math.cos(angle)*.067,.22+math.sin(angle)*.067,0])
        pts=[center+np.array([.057*math.cos(a),.057*math.sin(a),.008]) for a in np.linspace(0,math.tau,17)]
        for a,b in zip(pts,pts[1:]):
            prop.rod(a,b,.0055,RED,sides=8)
    for i in range(7):
        x=(i-3)*.011
        for a,b in [((x-.037,.17,0),(x+.039,.263,0)),((x+.039,.17,.012),(x-.037,.263,.012))]:
            prop.rod(a,b,.0056,"#da3037",sides=8)
    for x in (-.023,.023):
        prop.rod((x,.126,0),(x,.097,0),.005,RED)
        for i in (-1,0,1):
            prop.rod((x,.1,0),(x+i*.009,0,.002),.0045,GOLD if i==0 else RED,sides=8)


def hot_food(prop, kind):
    if kind=="fondue":
        prop.rod((0,0,0),(0,.025,0),.14,DARK)
        prop.rod((0,.027,0),(0,.056,0),.073,GOLD)
        for angle in np.linspace(0,math.tau,4,endpoint=False):
            x,z=.1*math.cos(angle),.1*math.sin(angle)
            prop.rod((x,.018,z),(x,.105,z),.011,METAL)
        prop.rod((0,.095,0),(0,.185,0),.13,RED,tip=.16,sides=24)
        prop.rod((0,.185,0),(0,.191,0),.147,"#dfad59",sides=24)
        for x in (-.075,.03,.108):
            prop.rod((x*.48,.178,0),(x,.316,.055),.0035,METAL)
            prop.rod((x,.316,.055),(x*1.22,.356,.065),.009,WOOD)
    else:
        for x,z in ((-.093,.052),(.062,.045),(0,-.095)):
            prop.rod((x,0,z),(x,.135,z),.040,"#aaa39b",tip=.055,sides=16)
            prop.rod((x,.135,z),(x,.137,z),.050,"#7d2934",sides=16)
            prop.rod((x-.012,.139,z),(x+.021,.14,z+.022),.007,"#ab7439")
            for i in range(12):
                a,b=i*math.tau/12,(i+1)*math.tau/12
                prop.rod((x+.058+.027*math.cos(a),.081+.027*math.sin(a),z),
                         (x+.058+.027*math.cos(b),.081+.027*math.sin(b),z),.005,"#aaa39b")

def cabin(prop, kind):
    width, depth = (2.55, 4.15)
    prop.box((0, .08, 0), (width, .16, depth), DARK)
    prop.box((0, 2.42, 0), (width+.11, .17, depth+.11), METAL)
    prop.box((0,1.27,-depth/2+.06),(width,2.24,.12), BLUE)
    for x in (-width/2+.055, width/2-.055):
        prop.box((x,1.27,0),(.11,2.24,depth),BLUE)
        for z in np.linspace(-1.87,1.87,13):
            prop.box((x*1.04,1.25,z),(.04,2.13,.06),BLUE)
    for x in (-1.04,1.04):
        prop.box((x,1.27,depth/2-.055),(.47,2.24,.11),BLUE)
    for x in (-.40,.4):
        prop.box((x,1.19,depth/2-.045),(.78,2.04,.092), WHITE)
        if kind == "control":
            prop.box((x,1.70,depth/2+.005),(.55,.56,.024),DARK)
        prop.rod((x-.26,1.06,depth/2+.055),(x-.10,1.06,depth/2+.055),.018,METAL)
    text = "EVENT/CONTROL" if kind == "control" else "CHANGING/ROOM"
    prop.texture([(-.44,2.16,depth/2+.019),(.44,2.16,depth/2+.019),
                  (.44,2.43,depth/2+.019),(-.44,2.43,depth/2+.019)], graphic(text,"rect",DARK,WHITE))


def security(prop):
    for x in (-1.35,1.35):
        for z in (-.78,.78):
            prop.rod((x,0,z),(x,2.34,z),.036,METAL)
    prop.prism([(-1.46,2.32,-.86),(-1.46,2.32,.86),(1.46,2.32,.86),(1.46,2.32,-.86)],
               (0,.11,0), DARK)
    for x in (-.48,.48):
        prop.box((x,.98,.12),(.12,1.96,.29),METAL)
    prop.box((0,1.99,.12),(1.08,.12,.30),METAL)
    prop.box((.34,1.70,.277),(.17,.11,.016),DARK)
    prop.box((-.95,.77,-.03),(.59,.065,1.14),WHITE)
    for z in (-.53,.46):
        prop.rod((-.93,0,z),(-.93,.74,z),.023,DARK)
    prop.texture([(-.53,2.23,.89),(.53,2.23,.89),(.53,2.50,.89),(-.53,2.50,.89)],
                 graphic("SECURITY","rect",BLUE,WHITE))


def towable_trailer(prop):
    prop.box((0,.76,-.20),(2.45,.28,5.1),DARK)
    prop.box((0,1.86,-.20),(2.45,2.10,5.1),WHITE)
    prop.box((0,2.94,-.20),(2.51,.10,5.23),METAL)
    for x in (-1.25,1.25):
        for z in (-1.12,-.38):
            wheel(prop,x,.375,z,.363,DARK)
    for x in (-.63,.63):
        prop.rod((x,.58,2.30),(0,.58,3.25),.051,METAL)
    prop.rod((0,.03,3.01),(0,.59,3.01),.036,METAL)
    for z in (-1.32,.43,1.51):
        prop.box((1.23,1.81,z),(.045,1.77,.66),BLUE)
        prop.box((1.26,2.37,z),(.008,.13,.18),WHITE)
        prop.rod((1.27,1.67,z+.25),(1.33,1.67,z+.25),.023,METAL)
        for j in range(3):
            prop.box((1.42+j*.20,.101+j*.09,z),(.25,.056,.79),METAL)


def utility_vehicle(prop, kit):
    van = kit in {"satellite", "broadcast"}
    length = 5.85 if van else 7.20
    w = 2.08 if van else 2.45
    front, rear = length*.5, -length*.5
    body_color = "#d8e1e1" if kit!="swat" else "#283643"
    prop.box((0,.73,0),(w,.56,length*.93),DARK)
    for x in (-w/2,w/2):
        for z in (front-1.18,rear+1.23):
            wheel(prop,x,.45,z,.41,DARK)
    prop.box((0,1.31,front-.83),(w*.94,1.13,1.42),body_color)
    prop.prism([(-w*.46,1.53,front-.42),(w*.46,1.53,front-.42),
                (w*.46,2.53,front-.98),(-w*.46,2.53,front-.98)],(0,0,-1.16),body_color)
    prop.prism([(-w*.37,1.69,front-.49),(w*.37,1.69,front-.49),
                (w*.37,2.36,front-.866),(-w*.37,2.36,front-.866)],(0,0,.021), "#354956")
    for x in (-w*.48,w*.48):
        prop.box((x,2.12,front-1.43),(.03,.47,.67),"#354956")
        prop.box((x,.95,front-.17),(.15,.17,.17),WHITE)
        prop.box((x,1.05,rear+.07),(.15,.13,.14),RED)
    prop.box((0,.90,front-.165),(w,.16,.26),METAL)
    body_len=length-2.12
    prop.box((0,1.44,rear+body_len/2+.06),(w,.98,body_len), body_color)
    body_top=2.55 if van else 2.95
    prop.box((0,(1.9+body_top)/2,rear+body_len/2+.06),(w,body_top-1.9,body_len),body_color)
    if kit == "screen":
        prop.box((0,2.18,rear+1.99),(1.78,.53,3.15),METAL)
        prop.box((0,3.52,rear+2.02),(.21,1.48,3.92),DARK)
        prop.box((.123,3.53,rear+2.02),(.016,1.31,3.74),BLUE)
        for j in range(6):
            prop.box((.135,3.06+j*.168,rear+2.02),(.008,.044,3.70), "#3070ad")
    if kit in {"satellite", "broadcast", "outside-broadcast"}:
        prop.rod((0,body_top,0),(0,body_top+.41,0),.065,METAL)
        for i in range(24):
            a,b=i*math.tau/24,(i+1)*math.tau/24
            prop.mesh([(0,body_top+.41,-.55),
                       (.83*math.cos(a),body_top+.70+.41*math.sin(a),-.58+.55*math.sin(a)),
                       (.83*math.cos(b),body_top+.70+.41*math.sin(b),-.58+.55*math.sin(b))],[(0,1,2)],WHITE)
        prop.rod((0,body_top+.46,-.55),(0,body_top+.93,-.94),.037,METAL)
        prop.box((0,body_top+.937,-.98),(.12,.11,.14),DARK)
    if kit in {"broadcast", "outside-broadcast"}:
        prop.rod((-.65,body_top,rear+.36),(-.65,body_top+.63,rear+.36),.035,METAL)
        for x in (-w/2,w/2):
            prop.box((x,1.66,rear+body_len/2),(.026,.18,body_len*.94),BLUE)
    if kit == "wax":
        prop.box((w*.51,1.69,rear+1.63),(.12,1.00,2.71),DARK)
        prop.prism([(w*.51,2.28,rear+.28),(w*.51,2.28,rear+2.90),
                    (w*.91,2.58,rear+2.90),(w*.91,2.58,rear+.28)],(0,.052,0),BLUE)
        prop.box((w*.54,1.32,rear+1.59),(.27,.052,2.70),WOOD)
        for z in (rear+.55,rear+.67):
            prop.rod((w*.57,.92,z),(w*.57,2.06,z+.16),.043,RED)
    if kit == "swat":
        for x in (w*.494,-w*.494):
            for z in np.linspace(rear+.43,rear+body_len-.17,4):
                prop.box((x,1.90,z),(.036,.23,.22),DARK)
        prop.box((0,body_top+.12,front-1.59),(.91,.13,.19),BLUE)
        prop.box((0,.76,front-.059),(w,.38,.278),DARK)


def ride_on_roller(prop):
    prop.box((0,.62,0),(1.36,.25,2.26), GOLD)
    prop.box((0,.88,-.28),(1.29,.37,1.25),GOLD)
    for z in (-.83,.82):
        prop.rod((-.69,.36,z),(.69,.36,z),.355,METAL,sides=24)
        for x in (-.67,.67):
            prop.rod((x,.36,z),(x,.55,z),.065,DARK)
    prop.box((0,1.12,-.27),(.39,.087,.39),DARK)
    prop.box((0,1.32,-.43),(.36,.34,.086),DARK)
    prop.rod((0,1.09,.25),(0,1.37,.27),.028,METAL)
    prop.rod((0,1.37,.27),(0,1.407,.27),.102,DARK)
    for x in (-.57,.57):
        prop.rod((x,.74,-.62),(x,1.94,-.62),.035,DARK)
    prop.rod((-.57,1.94,-.62),(.57,1.94,-.62),.034,DARK)


def urinal_pod(prop):
    prop.rod((0,0,0),(0,.08,0),.96,DARK,sides=12)
    prop.rod((0,.06,0),(0,1.89,0),.33,BLUE)
    for i in range(4):
        angle=i*math.pi/2
        x,z=math.cos(angle),math.sin(angle)
        prop.prism([(0,.082,0),(x*.89,.082,z*.89),(x*.89,1.85,z*.89),(0,1.85,0)],
                   (-z*.038,0,x*.038),BLUE)
        ox,oz=(x-z)*.44,(z+x)*.44
        sphere(prop,(ox,.68,oz),(.16,.095,.16),WHITE,7,12)
        prop.rod((ox,.36,oz),(ox,.655,oz),.038,METAL)
        sphere(prop,(ox,.75,oz),(.132,.016,.132),"#afb8b9",5,10)


def competition_ramp(prop):
    prop.box((0,.74,-1.32),(1.61,.14,1.48),METAL)
    prop.prism([(-.74,.0,1.80),(.74,.0,1.80),(.74,.76,-.60),(-.74,.76,-.60)],
               (0,.085,0), WOOD)
    for x in (-.76,.76):
        for z in (-2.02,-.63):
            prop.rod((x,0,z),(x,1.63,z),.028,METAL)
        prop.rod((x,1.63,-2.02),(x,1.63,-.63),.037,BLUE)
    for i in range(7):
        prop.box((0,.825-(i+1)*.108,-.51+(i+1)*.32),(1.48,.025,.041),DARK)


def fair_stall(prop, kind):
    for x in (-1.24,1.24):
        for z in (-.78,.78):
            prop.rod((x,0,z),(x,2.47,z),.044,WOOD)
    for i in range(10):
        prop.box(((i-4.5)*.259,2.48,0),(.261,.10,1.86),RED if i%2 else WHITE)
    prop.box((0,.49,.28),(2.39,.92,.93),BLUE)
    prop.box((0,.96,.28),(2.49,.10,.98),WOOD)
    if kind=="duck":
        prop.box((0,1.022,.20),(1.99,.032,.76),"#66adc4")
        for x,z in ((-.62,.02),(-.38,.43),(.15,.12),(.46,.38),(.69,.09)):
            sphere(prop,(x,1.08,z),(.12,.065,.080),GOLD,7,12)
            sphere(prop,(x+.071,1.134,z),(.043,.043,.044),GOLD,7,10)
            prop.box((x+.11,1.124,z),(.055,.024,.041),"#e77a2c")
        title="DUCK/POND"
    else:
        for x in (-.71,0,.71):
            for dx,y in ((-.115,1.02),(.115,1.02),(0,1.25)):
                prop.rod((x+dx,y,0),(x+dx,y+.15,0),.072,WHITE,tip=.059)
                prop.rod((x+dx,y+.15,0),(x+dx,y+.21,0),.057,WHITE,tip=.029)
        title="MILK BOTTLE/TOSS"
    prop.texture([(-.77,2.15,.936),(.77,2.15,.936),(.77,2.47,.936),(-.77,2.47,.936)],
                 graphic(title,"rect",DARK,WHITE))


def bungee(prop):
    for x in (-1.75,1.75):
        for z in (-1.65,1.65):
            prop.rod((x,0,z),(x*.7,5.10,z*.72),.066,METAL)
            prop.rod((x*.7,5.10,z*.72),(0,1.32,z*.15),.017,BLUE)
    prop.rod((0,.44,0),(0,.50,0),1.51,DARK,sides=36)
    points=[(1.62*math.cos(t),.49,1.62*math.sin(t)) for t in np.linspace(0,math.tau,25)]
    for a,b in zip(points,points[1:]):
        prop.rod(a,b,.096,BLUE,sides=8)
    for a in points[::4]:
        prop.rod((a[0],0,a[2]),a,.045,METAL)


def aid_tent(prop):
    for x in (-1.43, 1.43):
        for z in (-1.43, 1.43):
            prop.rod((x, 0, z), (x, 2.26, z), .049, METAL)
    corners = [(-1.54, 2.22, -1.54), (1.54, 2.22, -1.54),
               (1.54, 2.22, 1.54), (-1.54, 2.22, 1.54)]
    for i, (a, b) in enumerate(zip(corners, corners[1:] + corners[:1])):
        prop.mesh([a, b, (0, 2.98, 0)], [(0, 1, 2)], WHITE)
        if i != 2:
            prop.mesh([a, b, (b[0], .06, b[2]), (a[0], .06, a[2])],
                      [(0, 1, 2), (0, 2, 3)], "#e4e2d9")
    prop.box((0, 2.22, 1.55), (1.45, .26, .027), WHITE)
    prop.texture([(-.68, 2.105, 1.565), (.68, 2.105, 1.565), (.68, 2.335, 1.565), (-.68, 2.335, 1.565)],
                 graphic("FIRST AID", "rect", RED, WHITE))
    prop.box((-.56, .56, .12), (.62, .09, 1.87), "#3c8183")
    prop.box((-.56, .63, -.52), (.51, .073, .32), WHITE)
    for z in (-.56, .70):
        prop.rod((-.80, 0, z), (-.33, .54, z), .028, METAL)
        prop.rod((-.33, 0, z), (-.80, .54, z), .028, METAL)
    prop.box((.58, .38, -.69), (.65, .76, .48), RED)
    prop.box((.58, .42, -.441), (.25, .06, .015), WHITE)
    prop.box((.58, .42, -.440), (.06, .25, .015), WHITE)


def low_cable_ramp(prop):
    profile = [(-.38, 0, -.27), (-.38, .036, -.074), (-.38, .036, .074), (-.38, 0, .27)]
    prop.prism(profile, (.76, 0, 0), DARK)
    prop.box((0, .036, 0), (.75, .004, .139), GOLD)
    for x in np.linspace(-.33, .33, 9):
        prop.box((x, .039, 0), (.013, .004, .124), "#a65b23")

def write_asset(icon, name, english, bucket, prop, rows, source_file="scripts/build-icon-props.py", reference=None):
    slug = "scendance-plan-" + icon
    model = LIBRARY / "model" / (slug + ".glb")
    thumb = LIBRARY / "thumb" / (slug + ".webp")
    data, (width, height, depth), triangles = prop.export()
    model.write_bytes(data)
    prop.preview(thumb)
    rows[slug] = {
        "slug": slug, "name": english, "sourceFile": source_file,
        "sourceCategory": "scendance-icon-props", "width": width, "depth": depth, "height": height,
        "bytes": len(data), "triangles": triangles, "sha256": hashlib.sha256(data).hexdigest(),
        "license": {"slug": "project-authored", "name": "Scendance original asset"},
        "glb": model.as_posix(), "thumb": thumb.as_posix(), "keyword": "icon-exact",
        "creator": "Scendance", "iconSlug": icon, "label": {"name": name, "bucket": bucket},
    }
    if reference:
        rows[slug]["designReference"] = reference


def main():
    from icon_props_completion import COMPLETION_PROPS, DESIGN_REFERENCES
    from icon_props_variants import VARIANT_PROPS

    assets = json.loads(Path("frontend/public/oneplan-icons/manifest.json").read_text(encoding="utf-8"))["assets"]
    names = {a["slug"]: (a.get("name_zh"), a.get("name_en")) for a in assets}
    packs = json.loads(Path("frontend/public/oneplan-icons/packs.json").read_text(encoding="utf-8"))["packs"]
    for pack in packs:
        for item in pack["items"]:
            names.setdefault(item["asset_slug"], (item["name_zh"], item["name_en"]))
    rows = {}
    props = {
        "aluminum-trackway": ("logistics", lambda p: trackway(p, METAL, 2.4, 1.15, "rib")),
        "ground-protection-mats": ("logistics", lambda p: trackway(p, "#61706a", 2.4, 1.2, "stud")),
        "plastic-trackway": ("logistics", lambda p: trackway(p, "#40574f", 2.0, 1.0, "rib")),
        "training-wickets": ("sports", lambda p: wickets(p, True)),
        "alternate-wickets": ("sports", lambda p: wickets(p, False)),
        "cn-lantern": ("decor", lambda p: lantern(p, False)),
        "cn-lantern-riddle": ("decor", lambda p: lantern(p, True)),
        "cn-round-fan": ("decor", paper_fan),
        "cn-firecracker": ("decor", lambda p: firecracker(p, True)),
        "cn-candied-hawthorn": ("food", tanghulu),
        "cn-mooncake": ("food", mooncake),
        "cn-zongzi": ("food", zongzi),
        "cn-red-envelope": ("decor", red_envelope),
        "balloon-arch": ("structure", lambda p: arch(p, "balloon")),
        "balloons": ("decor", lambda p: (
            sphere(p, (-.18, .60, 0), (.13, .17, .13), RED),
            sphere(p, (.12, .69, .05), (.13, .17, .13), GOLD),
            sphere(p, (0, .8, -.10), (.13, .17, .13), BLUE),
            p.rod((0, 0, 0), (-.18, .43, 0), .003, DARK),
            p.rod((0, 0, 0), (.12, .52, .05), .003, DARK),
            p.rod((0, 0, 0), (0, .63, -.10), .003, DARK),
        )),
        "inflatable-arch": ("structure", lambda p: arch(p, "inflatable")),
        "truss-arch": ("structure", lambda p: arch(p, "truss")),
        "bouncy-castle": ("rides", bouncer),
        "yurt": ("structure", lambda p: shelter(p, "yurt")),
        "warming-dome": ("structure", lambda p: shelter(p, "dome")),
        "stretch-tent": ("structure", lambda p: shelter(p, "stretch")),
        "feather-flag": ("signage", lambda p: banner(p, "feather")),
        "pull-up-banner": ("signage", lambda p: banner(p, "pull-up")),
        "lamp-post-banner": ("signage", lambda p: banner(p, "lamp")),
        "signage-frame-2": ("signage", lambda p: sign_frame(p, 2)),
        "signage-frame-4": ("signage", lambda p: sign_frame(p, 4)),
        "crossing-point": ("logistics", road_marking),
        "vms-fixed": ("signage", lambda p: message_board(p, False)),
        "vms-mobile": ("signage", lambda p: message_board(p, True)),
        "water-refill-station": ("logistics", refill_station),
        "feed-station": ("food", lambda p: spot(p, "feed")),
        "cn-couplet": ("decor", lambda p: envelope_tag(p, "couplet")),
        "cn-wish-tablet": ("decor", lambda p: envelope_tag(p, "wish")),
        "cn-tangyuan": ("food", tangyuan),
        "cn-mugwort": ("plants", mugwort),
        "cn-firework": ("decor", lambda p: firecracker(p, False)),
        "cn-dragon-boat": ("vehicles", dragon_boat),
        "cn-opera-stage": ("stage", opera_stage),
        "targets-control": ("sports", cricket_targets),
        "lan-socket": ("digital", lambda p: network_wall(p, "lan")),
        "wifi": ("digital", lambda p: network_wall(p, "wifi")),
        "charity": ("exhibition", charity_display),
        "chuck-wagon": ("vehicles", chuck_wagon),
        "round-table-and-chairs": ("tables", round_dining),
        "accessible-portable-toilet": ("structure", lambda p: portable_wc(p, "accessible")),
        "gender-neutral-toilet": ("structure", lambda p: portable_wc(p, "unisex")),
        "accessible-ramp": ("structure", access_ramp),
        "ramp-turning": ("structure", lambda p: access_ramp(p, True)),
        "evacuation-chair": ("logistics", evacuation_chair),
        "cn-jade-rabbit": ("decor", jade_rabbit),
        "cn-chinese-knot": ("decor", chinese_knot),
        "fondue": ("food", lambda p: hot_food(p, "fondue")),
        "mulled-wine": ("food", lambda p: hot_food(p, "mulled")),
        "event-control": ("structure", lambda p: cabin(p, "control")),
        "changing-room": ("structure", lambda p: cabin(p, "changing")),
        "security-checkpoint": ("structure", security),
        "toilet-trailer": ("vehicles", towable_trailer),
        "large-screen-truck": ("vehicles", lambda p: utility_vehicle(p, "screen")),
        "satellite-van": ("vehicles", lambda p: utility_vehicle(p, "satellite")),
        "hb-van": ("vehicles", lambda p: utility_vehicle(p, "broadcast")),
        "team-wax-truck": ("vehicles", lambda p: utility_vehicle(p, "wax")),
        "swat-police-vehicle": ("vehicles", lambda p: utility_vehicle(p, "swat")),
        "heavy-roller": ("sports", ride_on_roller),
        "mens-urinal-pod": ("structure", urinal_pod),
        "time-trial-ramp": ("sports", competition_ramp),
        "duck-pond-booth": ("exhibition", lambda p: fair_stall(p, "duck")),
        "milk-bottle-toss": ("exhibition", lambda p: fair_stall(p, "bottle")),
        "bungee-trampoline": ("rides", bungee),
        "outside-broadcast-truck": ("vehicles", lambda p: utility_vehicle(p, "outside-broadcast")),
        "first-aid-point": ("logistics", aid_tent),
        "aid-station-electrolyte": ("logistics", lambda p: spot(p, "hydration")),
        "ada-low-profile-cable-matting": ("logistics", low_cable_ramp),
        **COMPLETION_PROPS,
    }
    for icon, recipe in SIGNS.items():
        prop = Prop()
        sign(prop, *recipe, portable=icon in {"lollypop-crossing", "road-closed", "road-ahead-closed", "detour", "diversion"})
        name, english = names[icon]
        if not any("\u4e00" <= c <= "\u9fff" for c in name):
            name = "导视牌（" + name + "）"
        write_asset(icon, name, english + " Sign", "signage", prop, rows)
    for icon, (bucket, create) in props.items():
        name, english = names[icon]
        name = {
            "wifi": "无线接入点",
            "crokicurl": "冰壶棋场（Crokicurl）",
            "skycam": "索道摄像机（Skycam）",
        }.get(icon, name)
        prop = Prop()
        create(prop)
        if icon in COMPLETION_PROPS:
            write_asset(icon, name, english, bucket, prop, rows,
                        "scripts/icon_props_completion.py", DESIGN_REFERENCES.get(icon))
        else:
            write_asset(icon, name, english, bucket, prop, rows)
    for variant, (icon, name, english, bucket, create) in VARIANT_PROPS.items():
        prop = Prop()
        create(prop)
        write_asset(variant, name, english, bucket, prop, rows, "scripts/icon_props_variants.py")
        rows["scendance-plan-" + variant]["variantOf"] = icon
    out = LIBRARY / "incoming-icon-original.json"
    out.write_text(json.dumps({"models": list(rows.values())}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(rows)} original icon props.")


if __name__ == "__main__":
    main()
