import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findMediaTool} from '../packages/media/src/tools.ts';
import type {MediaTool} from '../packages/media/src/tools.ts';
import {fileHash} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
let failures=0;
async function check(name:string,action:()=>Promise<string>){
 try{console.log(`OK ${name}: ${await action()}`);}
 catch(error){failures++;console.error(`FAIL ${name}: ${error instanceof Error?error.message:String(error)}`);}
}
await check('Node.js',async()=>{if(Number(process.versions.node.split('.')[0])<24)throw Error('需要 Node.js 24+，运行 nvm install 24 && nvm use 24');return process.version;});
const tools=new Map<MediaTool,string>();
for(const name of ['ffmpeg','ffprobe','rubberband'] as const)await check(name,async()=>{
 const binary=findMediaTool(name);if(!binary)throw Error(`未找到可执行文件，请安装或检查 YINGXU_${name.toUpperCase()} 配置`);
 const result=await runProcess(binary,[name==='rubberband'?'--version':'-version'],{timeout:10000});
 tools.set(name,binary);return `${binary} (${(result.stdout||result.stderr).trim().split('\n')[0]})`;
});
if(tools.has('ffmpeg')){
 await check('FFmpeg filters',async()=>{
  const result=await runProcess(tools.get('ffmpeg')!,['-hide_banner','-filters'],{timeout:10000});
  const missing=['subtitles','zscale'].filter(name=>!new RegExp(`\\s${name}\\s`).test(result.stdout));
  if(missing.length)throw Error(`缺少滤镜 ${missing.join(', ')}，请使用支持 libass、libzimg 的 FFmpeg`);return 'subtitles, zscale';
 });
 await check('FFmpeg encoders',async()=>{
  const result=await runProcess(tools.get('ffmpeg')!,['-hide_banner','-encoders'],{timeout:10000});
  const required=['libx264','aac','libmp3lame','png','gif','prores_ks','pcm_s16le'];
  const missing=required.filter(name=>!new RegExp(`\\s${name}\\s`).test(result.stdout));
  if(missing.length)throw Error(`缺少编码器 ${missing.join(', ')}`);return required.join(', ');
 });
}
await check('demo fixture',async()=>{
 const file=path.join(root,'fixtures/timeline-probe.mp4'),manifest=JSON.parse(await fs.readFile(path.join(root,'fixtures/demo.json'),'utf8'));
 if(await fileHash(file)!==manifest.sha256)throw Error('素材校验失败；恢复仓库内 fixtures 文件，或运行 npm run fixtures:generate');
 return 'repository-owned 6s / 30fps';
});
await check('bundled font',async()=>{
 const directory=path.join(root,'assets/fonts/source-han-sans-1.000');
 for(const name of ['SourceHanSansSC-Medium.otf','LICENSE.txt','NOTICE.txt'])await fs.access(path.join(directory,name));
 return 'Source Han Sans SC Medium + license';
});
if(process.argv.includes('--package')){
 await check('macOS packaging',async()=>{
  if(process.platform!=='darwin')throw Error('package:mac 必须在 macOS 上执行');
  for(const binary of ['/bin/cp','/usr/bin/plutil','/usr/bin/codesign','/usr/bin/git'])await fs.access(binary,fs.constants.X_OK);
  return process.arch;
 });
 await check('Electron',async()=>{await fs.access(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),fs.constants.X_OK);return 'npm ci installed Electron.app';});
}
if(failures){console.error(`环境检查未通过（${failures}项）。macOS 安装媒体工具：brew install ffmpeg rubberband；然后重新运行 npm run doctor。`);process.exitCode=1;}
else console.log('环境检查通过。');
