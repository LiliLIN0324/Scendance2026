import sys, json, math, collections
from PIL import Image
import numpy as np

def hist(path, top=24):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).reshape(-1,3)
    # quantize to 8 levels/channel? no: exact first
    exact = collections.Counter(tuple(int(x) for x in r) for r in a)
    n = len(a)
    # quantized 5-bit to group near-identical painterly values
    q = (a//8*8)
    qc = collections.Counter(tuple(int(x) for x in r) for r in q)
    out = {
        'file': path,
        'size': im.size,
        'unique_exact': len(exact),
        'unique_q8': len(qc),
        'top_exact': [[list(c), round(v/n*100,2)] for c,v in exact.most_common(top)],
        'top_q8': [[list(c), round(v/n*100,2)] for c,v in qc.most_common(top)],
        'mean': [round(float(x),1) for x in a.mean(axis=0)],
        'std': [round(float(x),1) for x in a.std(axis=0)],
    }
    return out

def edge_angle(path):
    im = Image.open(path).convert('L')
    a = np.asarray(im, dtype=np.float32)
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    gx[:,1:-1] = a[:,2:]-a[:,:-2]
    gy[1:-1,:] = a[2:,:]-a[:-2,:]
    mag = np.hypot(gx,gy)
    m = mag > 40
    ang = (np.degrees(np.arctan2(gy[m], gx[m])) + 180) % 180
    # normalize direction to 0..90 since edges repeat
    h, edges = np.histogram(ang, bins=90, range=(0,180))
    top = np.argsort(h)[::-1][:8]
    return {'bins_deg': [int(edges[i]) for i in top], 'counts': [int(h[i]) for i in top],
            'frac_45_50': float(((ang>40)&(ang<50)).mean()), 'frac_130_140': float(((ang>130)&(ang<140)).mean()),
            'frac_mag_gt40': float(m.mean())}

def pixelation(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    # how often 2x2 blocks are identical -> suggests nearest-neighbour upscale from half res
    b = a[:512//2*2,:512//2*2].reshape(256,2,256,2,3)
    same = (b.std(axis=(1,3))==0).all(axis=2)
    # horizontal adjacent identical fraction
    return {'frac_2x2_uniform': float(same.mean())}

for p in sys.argv[1:]:
    print(json.dumps({'hist':hist(p),'edges':edge_angle(p),'pix':pixelation(p)}, ensure_ascii=False, indent=1))
