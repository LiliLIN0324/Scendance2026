from PIL import Image
import numpy as np, sys
for p in sys.argv[1:]:
    im=Image.open(p).convert('RGB')
    q=im.quantize(colors=10,method=Image.MEDIANCUT,dither=Image.NONE).convert('RGB')
    a=np.asarray(q).reshape(-1,3)
    u,c=np.unique(a,axis=0,return_counts=True)
    o=np.argsort(c)[::-1]
    print(p)
    for i in o:
        rgb=u[i]; print('  #%02X%02X%02X  %5.1f%%'%(rgb[0],rgb[1],rgb[2],c[i]/len(a)*100))
