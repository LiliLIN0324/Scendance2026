import math, sys, urllib.request, pathlib
from PIL import Image
import io

def build(lat, lng, z, r, out):
    world = 256 * 2 ** z
    cx = (lng + 180) / 360 * world
    cy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * world
    tx, ty = int(cx // 256), int(cy // 256)
    side = (2 * r + 1) * 256
    canvas = Image.new('RGB', (side, side))
    for y in range(ty - r, ty + r + 1):
        for x in range(tx - r, tx + r + 1):
            url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            data = urllib.request.urlopen(url, timeout=30).read()
            im = Image.open(io.BytesIO(data)).convert('RGB')
            canvas.paste(im, ((x - tx + r) * 256, (y - ty + r) * 256))
    canvas.thumbnail((1000, 1000))
    canvas.save(out, quality=85)
    print(out, canvas.size)

if __name__ == '__main__':
    build(float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
