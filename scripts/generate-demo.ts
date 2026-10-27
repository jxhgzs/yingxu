import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ffmpeg,fileHash} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';

// Self-generated test pattern and tone only; no editor cache or research media.
const directory=fileURLToPath(new URL('../fixtures/',import.meta.url));
await fs.mkdir(directory,{recursive:true});
const file=path.join(directory,'timeline-probe.mp4');
await runProcess(ffmpeg(),['-hide_banner','-loglevel','error','-nostdin','-y',
 '-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=6',
 '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6',
 '-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p',
 '-c:a','aac','-b:a','96k','-t','6','-map_metadata','-1','-movflags','+faststart',file],{timeout:60000});
const sha256=await fileHash(file);
await fs.writeFile(path.join(directory,'demo.json'),JSON.stringify({file:'timeline-probe.mp4',sha256,source:'FFmpeg lavfi testsrc2 + sine',width:640,height:360,fps:30,duration:6},null,2)+'\n');
process.stdout.write(`fixtures/timeline-probe.mp4 SHA256 ${sha256}\n`);
