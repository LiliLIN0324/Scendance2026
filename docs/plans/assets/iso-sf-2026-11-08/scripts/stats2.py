import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

def stats(path, crop=None):
    im = Image.open(path).convert('RGB')
    if crop: im = im.crop(crop)
    a = np.asarray(im).astype(np.float32)/255.0
    lum = 0.299*a[...,0]+0.587*a[...,1]+0.114*a[...,2]
    mx = a.max(2); mn=a.min(2); sat=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0)
    gx=np.zeros_like(lum); gy=np.zeros_like(lum)
    gx[:,1:-1]=lum[:,2:]-lum[:,:-2]; gy[1:-1,:]=lum[2:,:]-lum[:-2,:]
    mag=np.hypot(gx,gy)
    p=np.percentile(lum,[1,5,25,50,75,95,99])
    # 暗部中位灰度
    dark=lum[lum<0.22]
    out={
      'file':path,'crop':crop,'size':im.size,
      'lum_p1_5_25_50_75_95_99':[round(float(x),3) for x in p],
      'lum_mean':round(float(lum.mean()),3),'lum_std':round(float(lum.std()),3),
      'sat_mean':round(float(sat.mean()),3),
      'edge_frac_grad_gt_0.16':round(float((mag>0.16).mean()*100),2),
      'edge_frac_grad_gt_0.30':round(float((mag>0.30).mean()*100),2),
      'dark_frac':round(float((lum<0.22).mean()*100),2),
      'dark_median_lum':round(float(dark.mean()),3) if dark.size else None,
      'bright_frac':round(float((lum>0.86).mean()*100),2),
    }
    # 主色（8 级量化）
    q=(np.asarray(im)//8*8).reshape(-1,3)
    uq,cnt=np.unique(q,axis=0,return_counts=True)
    o=np.argsort(cnt)[::-1][:12]
    out['top12']=[[list(map(int,uq[i])),round(float(cnt[i]/len(q)*100),2)] for i in o]
    out['unique_q8']=int(len(uq))
    return out

jobs=[]
for arg in sys.argv[1:]:
    if '@' in arg:
        f,c=arg.split('@'); x,y,w,h=map(int,c.split(',')); jobs.append((f,(x,y,x+w,y+h)))
    else: jobs.append((arg,None))
for f,c in jobs:
    print(json.dumps(stats(f,c),ensure_ascii=False))
