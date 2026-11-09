import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.float32)/255.0

def rgb2hsv(a):
    r,g,b = a[...,0],a[...,1],a[...,2]
    mx=a.max(2); mn=a.min(2); d=mx-mn
    h=np.zeros_like(mx)
    m=d>1e-6
    idx=(mx==r)&m; h[idx]=((g-b)[idx]/d[idx])%6
    idx=(mx==g)&m; h[idx]=((b-r)[idx]/d[idx])+2
    idx=(mx==b)&m; h[idx]=((r-g)[idx]/d[idx])+4
    h*=60
    s=np.where(mx>0,d/np.maximum(mx,1e-6),0)
    return h,s,mx

def comp(p, label):
    a=load(p); h,s,v=rgb2hsv(a)
    green=(h>65)&(h<165)&(s>0.16)&(v>0.10)
    teal=(h>=165)&(h<215)&(s>0.12)
    warm=(h<38)&(s>0.14)
    grey=(s<0.13)
    dark=(v<0.22)
    bright=(v>0.86)&(s<0.12)
    n=a.shape[0]*a.shape[1]
    print(json.dumps({
      'file':p,'px':[a.shape[1],a.shape[0]],
      'mean_rgb':[round(float(x*255),1) for x in a.reshape(-1,3).mean(0)],
      'mean_sat':round(float(s.mean()),3),'mean_val':round(float(v.mean()),3),
      'pct_green':round(float(green.mean()*100),1),
      'pct_teal_water':round(float(teal.mean()*100),1),
      'pct_warm_roof':round(float(warm.mean()*100),1),
      'pct_grey':round(float(grey.mean()*100),1),
      'pct_dark':round(float(dark.mean()*100),1),
      'pct_near_white':round(float(bright.mean()*100),1),
    }, ensure_ascii=False))

for p in sys.argv[1:]:
    comp(p,'')
