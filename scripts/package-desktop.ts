import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../packages/media/src/process.ts';
import {fileHash} from '../packages/media/src/probe.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='darwin')throw Error('PACKAGING_REQUIRES_MACOS');
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const timestamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/[- :]/g,'');
const target=path.join(root,'artifacts/desktop',timestamp,'映序剪辑.app');
await fs.access(path.join(root,'dist/index.html'));await fs.access(path.join(root,'dist-desktop/service/server.mjs'));
await fs.mkdir(path.dirname(target),{recursive:true});
await runProcess('/bin/cp',['-cR',path.join(root,'node_modules/electron/dist/Electron.app'),target],{timeout:120000});
const appRoot=path.join(target,'Contents/Resources/app');await fs.mkdir(appRoot,{recursive:true});
for(const p of ['dist','dist-desktop/service','apps/desktop'])await fs.cp(path.join(root,p),path.join(appRoot,p),{recursive:true});
await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'yingxu-editor',version,type:'module',main:'apps/desktop/main.mjs'}));
await fs.mkdir(path.join(appRoot,'fixtures'),{recursive:true});
const fixture=path.resolve(root,'../剪映5.9.0复刻分析_20261018/fixtures/timeline-probe.mp4');
await fs.copyFile(fixture,path.join(appRoot,'fixtures/timeline-probe.mp4'));
const plist=path.join(target,'Contents/Info.plist');
for(const [key,value]of Object.entries({CFBundleIdentifier:'cn.yingxu.editor.dev',CFBundleDisplayName:'映序剪辑',CFBundleName:'映序剪辑',CFBundleShortVersionString:version,CFBundleVersion:version}))
  await runProcess('/usr/bin/plutil',['-replace',key,'-string',value,plist]);
await runProcess('/usr/bin/codesign',['--force','--deep','--sign','-',target],{timeout:120000});
const commit=await runProcess('/usr/bin/git',['rev-parse','HEAD'],{cwd:root});
const result={version,appPath:target,sourceCommit:commit.stdout.trim(),backendHash:await fileHash(path.join(root,'dist-desktop/service/server.mjs')),
  fixtureHash:await fileHash(fixture),runtime:'Electron 44.6.0',nativeMediaDependency:'/opt/homebrew/bin/ffmpeg + ffprobe',signing:'local ad-hoc; not a notarized installer'};
await fs.writeFile(path.join(path.dirname(target),'build.json'),JSON.stringify(result,null,2));
await fs.writeFile(path.join(root,'artifacts/desktop/latest.json'),JSON.stringify(result,null,2));
process.stdout.write(JSON.stringify(result,null,2)+'\n');
