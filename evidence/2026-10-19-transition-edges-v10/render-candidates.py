import subprocess,json
from pathlib import Path
root=Path('artifacts/qa/transitions-v10');rows=[]
for kind,mode in [('wipe','direct-bilinear'),('circle','direct-bilinear'),('wipe','direct-accurate'),('circle','direct-accurate')]:
 target=root/f'{kind}-{mode}.mp4';args=['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-threads','2','-filter_complex_threads','1','-i','/private/tmp/yingxu-transition-grid-v8.mp4','-i','/private/tmp/yingxu-transition-grid-v8.mp4','-filter_complex_script',str(root/f'{kind}-{mode}.filter'),'-map','[outv]','-map','[outa]','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-r','30','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-c:a','aac','-ar','44100','-b:a','192k','-frames:v','120','-t','4',str(target)];r=subprocess.run(args,text=True,capture_output=True);rows.append({'kind':kind,'mode':mode,'args':args,'exit':r.returncode,'stderr':r.stderr});print(kind,mode,r.returncode,flush=True)
 if r.returncode:break
(root/'candidate-render-records.json').write_text(json.dumps(rows,indent=2))
