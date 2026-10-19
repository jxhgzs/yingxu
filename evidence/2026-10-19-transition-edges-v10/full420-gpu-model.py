import numpy as np,subprocess,json
from pathlib import Path
W,H=1280,720;size=W*H;results=[]
def up(uv):
 x=(np.arange(W)-.5)/2;y=(np.arange(H)-.5)/2;x0=np.floor(x).astype(int);y0=np.floor(y).astype(int);dx=x-x0;dy=y-y0
 a=uv[np.clip(y0,0,H//2-1)[:,None],np.clip(x0,0,W//2-1)[None,:]];b=uv[np.clip(y0,0,H//2-1)[:,None],np.clip(x0+1,0,W//2-1)[None,:]];c=uv[np.clip(y0+1,0,H//2-1)[:,None],np.clip(x0,0,W//2-1)[None,:]];d=uv[np.clip(y0+1,0,H//2-1)[:,None],np.clip(x0+1,0,W//2-1)[None,:]];return (a*(1-dx)+b*dx)*(1-dy[:,None])+(c*(1-dx)+d*dx)*dy[:,None]
def source(rgb,kernel):
 a=rgb.astype(float)/255;y=a@np.array([.2126,.7152,.0722]);uv=np.stack([(a[:,:,2]-y)/(2*(1-.0722)),(a[:,:,0]-y)/(2*(1-.2126))],axis=2);out=np.zeros((H//2,W//2,2))
 for dy,wy in kernel:
  for dx,wx in kernel:out+=uv[np.clip(np.arange(H//2)*2+dy,0,H-1)[:,None],np.clip(np.arange(W//2)*2+dx,0,W-1)[None,:]]*wy*wx
 return (np.floor(y*219+16+.5)-16)/219,(np.floor(out*224+128+.5)-128)/224
for kind,mid,native in [('wipe',61,'/Users/tal/Downloads/yingxu-native-wipe-canvas720-v8-2004.mov'),('circle',60,'/Users/tal/Downloads/yingxu-native-circle-canvas720-v8-2002.mov')]:
 ids=list(range(45,75));raw=subprocess.check_output(['/opt/homebrew/bin/ffmpeg','-v','error','-i',native,'-vf',"select='gte(n,45)*lt(n,75)'",'-fps_mode','passthrough','-pix_fmt','yuv420p','-f','rawvideo','-']);data=np.frombuffer(raw,np.uint8).reshape(30,size*3//2);caps=[np.frombuffer(Path(f'artifacts/qa/plane-edges-v9/capture-{kind}-{mid}-{side}.rgba').read_bytes(),np.uint8).reshape(H,W,4)[:,:,:3] for side in ['a','b']];X=np.arange(W)+.5;Y=np.arange(H)+.5;CX=np.arange(W//2)*2+.5;CY=np.arange(H//2)*2+.5;rowsByModel=[]
 for name,kernel in [('point',[(0,1)]),('box2',[(0,.5),(1,.5)]),('bilinear4',[(-1,.125),(0,.375),(1,.375),(2,.125)])]:
  a,b=[source(cap,kernel) for cap in caps];rows=[]
  for i,n in enumerate(ids):
   p=(n-45)/30;mask=X[None,:]>W*(1-p) if kind=='wipe' else np.hypot(X[None,:]-W/2,Y[:,None]-H/2)<p*np.hypot(W,H)/2;cmask=CX[None,:]>W*(1-p) if kind=='wipe' else np.hypot(CX[None,:]-W/2,CY[:,None]-H/2)<p*np.hypot(W,H)/2;y=np.where(mask,b[0],a[0]);uv=np.where(cmask[:,:,None],b[1],a[1]);u=up(uv[:,:,0]);v=up(uv[:,:,1]);r=y+2*(1-.2126)*v;bl=y+2*(1-.0722)*u;g=(y-.2126*r-.0722*bl)/.7152;candidate=np.floor(np.clip(np.stack([r,g,bl],axis=2),0,1)*255+.5).astype(np.uint8)
   raw=data[i];ny=(raw[:size].reshape(H,W).astype(float)-16)/219;nu=up((raw[size:size+size//4].reshape(H//2,W//2).astype(float)-128)/224);nv=up((raw[size+size//4:].reshape(H//2,W//2).astype(float)-128)/224);nr=ny+2*(1-.2126)*nv;nb=ny+2*(1-.0722)*nu;ng=(ny-.2126*nr-.0722*nb)/.7152;reference=np.floor(np.clip(np.stack([nr,ng,nb],axis=2),0,1)*255+.5).astype(np.uint8);diff=np.abs(candidate.astype(np.int16)-reference);loc=np.unravel_index(diff.argmax(),diff.shape);rows.append({'frame':n,'mae':float(diff.mean()),'max':int(diff.max()),'over3':int((diff>3).sum()),'worst':{'x':int(loc[1]),'y':int(loc[0]),'channel':int(loc[2])}})
  model={'physicalModel':name,'kernel':kernel,'mae':float(np.mean([r['mae'] for r in rows])),'max':max(r['max'] for r in rows),'frames':rows};rowsByModel.append(model);print(kind,name,model['mae'],model['max'],flush=True)
 results.append({'kind':kind,'models':rowsByModel})
Path('artifacts/qa/transitions-v10/full420-gpu-model.json').write_text(json.dumps({'scope':'Offline CPU model, not actual GPU. Actual0.9GPU source FBOs -> fixed709 limited8 -> finite standard downsample footprints -> unchanged plane masks -> centered bilinear chroma reconstruction. Compare all pixels of frames45..74 to native rawYUV reconstruction whose browser center/center model was independently verified within1LSB on6real captures. No fitted weights.','results':results},indent=2))
