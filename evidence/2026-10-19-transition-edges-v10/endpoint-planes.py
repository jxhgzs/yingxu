from pathlib import Path
import subprocess,json,numpy as np,hashlib
W,H=1280,720;size=W*H;root=Path('artifacts/qa/transitions-v10');source='artifacts/qa/transitions-v8/spatial-source.mp4';native='/Users/tal/Downloads/yingxu-native-wipe-canvas720-v8-2004.mov'
def decode(file,fmt,n=0,vf=None):
 return subprocess.check_output(['/opt/homebrew/bin/ffmpeg','-v','error','-i',file,'-vf',f"select='eq(n,{n})'"+(','+vf if vf else ''),'-frames:v','1','-pix_fmt',fmt,'-f','rawvideo','-'])
def planes(raw):
 a=np.frombuffer(raw,np.uint8);return [a[:size].reshape(H,W),a[size:size+size//4].reshape(H//2,W//2),a[size+size//4:].reshape(H//2,W//2)]
reference=planes(decode(native,'yuv420p'));rows=[]
variants=[('direct-default',None),('direct-accurate','scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p'),('rgb-roundtrip','scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgba,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p'),('direct-neighbor','scale=flags=neighbor,format=yuv420p'),('direct-bilinear','scale=flags=bilinear,format=yuv420p')]
for name,vf in variants:
 candidate=planes(decode(source,'yuv420p',vf=vf));metrics=[]
 for label,a,b in zip(['Y','U','V'],candidate,reference):
  d=np.abs(a.astype(np.int16)-b.astype(np.int16));worst=np.unravel_index(d.argmax(),d.shape);metrics.append({'plane':label,'mae':float(d.mean()),'max':int(d.max()),'over3':int((d>3).sum()),'worst':{'x':int(worst[1]),'y':int(worst[0]),'candidate':int(a[worst]),'native':int(b[worst])}})
 row={'variant':name,'filter':vf,'metrics':metrics};rows.append(row);print(row)
(root/'endpoint-planes.json').write_text(json.dumps({'source':source,'sourceSha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),'native':native,'nativeSha256':hashlib.sha256(Path(native).read_bytes()).hexdigest(),'scope':'One source/native frame0; no H264 encoding candidate and no alpha/transforms. Preserve full plane differences.','rows':rows},indent=2))
