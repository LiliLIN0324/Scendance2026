import numpy as np
from PIL import Image
import collections, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'z10-188-530.webp'
a = np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255.
lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
for th in (0.20, 0.28):
    runs = collections.Counter()
    for row in lum:
        m = row < th; i = 0; n = len(m)
        while i < n:
            if m[i]:
                j = i
                while j < n and m[j]: j += 1
                runs[j - i] += 1; i = j
            else:
                i += 1
    tot = sum(runs.values())
    top = sorted(runs.items())[:8]
    print('th', th, 'total_runs', tot, 'dist', [(k, round(v / tot * 100, 1)) for k, v in top])
