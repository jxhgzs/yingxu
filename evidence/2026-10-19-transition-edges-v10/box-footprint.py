import subprocess,numpy as np,json
from pathlib import Path
W,H=1280,720;size=W*H
source='artifacts/qa/transitions-v8/spatial-source.mp4';native='/Users/tal/Downloads/yingxu-native-wipe-canvas720-v8-2004.mov'
def read(file,fmt,frame):return np.frombuffer(subprocess.check_output(['/opt/homebrew/bin/ffmpeg','-v','error','-i',file,'-vf',f"select='eq(n,{frame})'",'-frames:v','1','-pix_fmt',fmt,'-f','rawvideo','-']),np.uint8)
results=[]
for sourceframe,nativeframe in [(0,0),(105,119)]:
 src=read(source,'yuv444p',sourceframe).reshape(3,H,W).astype(np.float64);raw=read(native,'yuv420p',nativeframe);ref=[raw[:size].reshape(H,W),raw[size:size+size//4].reshape(H//2,W//2),raw[size+size//4:].reshape(H//2,W//2)];rows=[]
 for name,ax,ay in [('point-top-left',False,False),('box-center',True,True),('left-cosited',False,True),('top-cosited',True,False)]:
  metrics=[]
  for plane in range(3):
   a=src[plane] if plane==0 else src[plane,::2,::2]
   if plane and ax:a=(src[plane,::2,::2]+src[plane,::2,1::2])/2
   if plane and ay:
    b=src[plane,1::2,::2]
    if ax:b=(src[plane,1::2,::2]+src[plane,1::2,1::2])/2
    a=(a+b)/2
   a=np.floor(a+.5);d=np.abs(a-ref[plane]);metrics.append({'plane':['Y','U','V'][plane],'mae':float(d.mean()),'max':int(d.max()),'over3':int((d>3).sum())})
  rows.append({'physicalModel':name,'horizontalPair':ax,'verticalPair':ay,'metrics':metrics})
 result={'sourceFrame':sourceframe,'nativeFrame':nativeframe,'models':rows};results.append(result);print(result)
Path('artifacts/qa/transitions-v10/box-footprint.json').write_text(json.dumps({'scope':'Four independently defined single-step 444->420 point/box/cosited footprints; no parameter search or encoding. Native encoded endpoints retain codec residual.','results':results},indent=2))
