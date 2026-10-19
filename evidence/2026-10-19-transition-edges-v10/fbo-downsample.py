from pathlib import Path
import subprocess,numpy as np,json
W,H=1280,720;size=W*H;root=Path('artifacts/qa/transitions-v10');native='/Users/tal/Downloads/yingxu-native-wipe-canvas720-v8-2004.mov'
raw=subprocess.check_output(['/opt/homebrew/bin/ffmpeg','-v','error','-i',native,'-vf',"select='eq(n,0)+eq(n,119)'",'-fps_mode','passthrough','-pix_fmt','yuv420p','-f','rawvideo','-']);data=np.frombuffer(raw,np.uint8).reshape(2,size*3//2)
kernels=[('point',[(0,1)]),('box2',[(0,.5),(1,.5)]),('bilinear4',[(-1,.125),(0,.375),(1,.375),(2,.125)]),('area4',[(-1,.25),(0,.25),(1,.25),(2,.25)])];results=[]
for endpoint,side in enumerate(['a','b']):
 rgb=np.frombuffer(Path(f'artifacts/qa/plane-edges-v9/capture-wipe-61-{side}.rgba').read_bytes(),np.uint8).reshape(H,W,4)[:,:,:3].astype(float)/255;y=rgb@np.array([.2126,.7152,.0722]);planes=[y*219+16,(rgb[:,:,2]-y)/(2*(1-.0722))*224+128,(rgb[:,:,0]-y)/(2*(1-.2126))*224+128];ref=[data[endpoint,:size].reshape(H,W),data[endpoint,size:size+size//4].reshape(H//2,W//2),data[endpoint,size+size//4:].reshape(H//2,W//2)];rows=[]
 for name,kernel in kernels:
  metrics=[]
  for plane,a in enumerate(planes):
   if plane:
    out=np.zeros((H//2,W//2))
    for dy,wy in kernel:
     for dx,wx in kernel:out+=a[np.clip(np.arange(H//2)*2+dy,0,H-1)[:,None],np.clip(np.arange(W//2)*2+dx,0,W-1)[None,:]]*wy*wx
    a=out
   a=np.floor(a+.5);d=np.abs(a-ref[plane]);i=np.unravel_index(d.argmax(),d.shape);metrics.append({'plane':['Y','U','V'][plane],'mae':float(d.mean()),'max':int(d.max()),'over3':int((d>3).sum()),'worst':{'x':int(i[1]),'y':int(i[0]),'candidate':int(a[i]),'native':int(ref[plane][i])}})
  rows.append({'physicalModel':name,'kernel':kernel,'metrics':metrics})
 r={'side':side,'nativeFrame':0 if side=='a' else 119,'models':rows};results.append(r);print(r)
(root/'fbo-downsample.json').write_text(json.dumps({'scope':'Actual GPU source RGB FBO -> fixed709/limited8 -> four predeclared separable point/box/bilinear/area footprints against native encoded endpoint YUV; no fitted weights.','results':results},indent=2))
