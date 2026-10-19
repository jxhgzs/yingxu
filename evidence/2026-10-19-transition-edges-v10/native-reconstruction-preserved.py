"""Defined 420 chroma reconstruction tests against prior real browser captures.
No fitted coefficients: BT709 limited8 and finite left/center phases only.
"""
from pathlib import Path
import numpy as np,subprocess,json
W,H=1280,720;size=W*H;root=Path('artifacts/qa/transitions-v10');results=[]
def linear(uv,phaseX,phaseY):
 x=(np.arange(W)+.5-phaseX)/2;y=(np.arange(H)+.5-phaseY)/2;x0=np.floor(x).astype(int);y0=np.floor(y).astype(int);dx=x-x0;dy=y-y0
 a=uv[np.clip(y0,0,H//2-1)[:,None],np.clip(x0,0,W//2-1)[None,:]];b=uv[np.clip(y0,0,H//2-1)[:,None],np.clip(x0+1,0,W//2-1)[None,:]];c=uv[np.clip(y0+1,0,H//2-1)[:,None],np.clip(x0,0,W//2-1)[None,:]];d=uv[np.clip(y0+1,0,H//2-1)[:,None],np.clip(x0+1,0,W//2-1)[None,:]]
 return (a*(1-dx)+b*dx)*(1-dy[:,None])+(c*(1-dx)+d*dx)*dy[:,None]
def metric(rgb,expected):
 d=np.abs(rgb.astype(np.int16)-expected.astype(np.int16));i=np.unravel_index(d.argmax(),d.shape);return {'mae':float(d.mean()),'max':int(d.max()),'over1':int((d>1).sum()),'over3':int((d>3).sum()),'worst':{'x':int(i[1]),'y':int(i[0]),'channel':int(i[2]),'candidate':int(rgb[i]),'browser':int(expected[i])}}
for kind,mid,native in [('wipe',61,'/Users/tal/Downloads/yingxu-native-wipe-canvas720-v8-2004.mov'),('circle',60,'/Users/tal/Downloads/yingxu-native-circle-canvas720-v8-2002.mov')]:
 ids=[0,mid,119];raw=subprocess.check_output(['/opt/homebrew/bin/ffmpeg','-v','error','-i',native,'-vf',"select='"+'+'.join(f'eq(n,{n})' for n in ids)+"'",'-fps_mode','passthrough','-pix_fmt','yuv420p','-f','rawvideo','-']);data=np.frombuffer(raw,np.uint8).reshape(3,size*3//2)
 for j,n in enumerate(ids):
  capture=Path('artifacts/qa/plane-edges-v9')/(f'capture-{kind}-native-end-'+('a' if n==0 else 'b')+'.rgba' if n in [0,119] else f'capture-{kind}-{mid}-native.rgba');expected=np.frombuffer(capture.read_bytes(),np.uint8).reshape(H,W,4)[:,:,:3];a=data[j];Y=(a[:size].reshape(H,W).astype(float)-16)/219;U=(a[size:size+size//4].reshape(H//2,W//2).astype(float)-128)/224;V=(a[size+size//4:].reshape(H//2,W//2).astype(float)-128)/224;rows=[]
  for name,hp,vp in [('nearest-block',None,None),('bilinear-left-center',.5,1),('bilinear-center-center',1,1),('bilinear-left-top',.5,.5),('bilinear-center-top',1,.5)]:
   if hp is None:u=np.repeat(np.repeat(U,2,axis=0),2,axis=1);v=np.repeat(np.repeat(V,2,axis=0),2,axis=1)
   else:u=linear(U,hp,vp);v=linear(V,hp,vp)
   r=Y+2*(1-.2126)*v;b=Y+2*(1-.0722)*u;g=(Y-.2126*r-.0722*b)/.7152;rgb=np.floor(np.clip(np.stack([r,g,b],axis=2),0,1)*255+.5).astype(np.uint8);row={'model':name,'phaseX':hp,'phaseY':vp,**metric(rgb,expected)};rows.append(row)
  result={'kind':kind,'frame':n,'capture':str(capture),'models':rows};results.append(result);print(kind,n,[(r['model'],round(r['mae'],5),r['max']) for r in rows])
(root/'native-reconstruction.json').write_text(json.dumps({'scope':'Actual native MOV raw YUV420 versus prior human-clicked browser2D/srgb nativeRGBA captures; all pixels. Matrix=BT709 limited8, finite standard phases only; no encode, gamma fit or edge exclusion.','results':results},indent=2))
