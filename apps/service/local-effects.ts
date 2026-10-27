import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {check} from '../../packages/core/src/document.ts';
import type {Asset} from '../../packages/core/src/document.ts';
import type {LocalEffect,LocalEffectCatalog} from '../../packages/core/src/local-effects.ts';
import {ffmpeg,fileHash} from '../../packages/media/src/probe.ts';
import {runProcess} from '../../packages/media/src/process.ts';
import reviewed from './local-effects-reviewed.json' with {type:'json'};

type Candidate={entry:LocalEffect;directory:string;files?:Record<string,string>};
/** Closed adapters for reviewed local resources. No Lua, downloaded code or
 * client paths are executed. Unknown resources are inventory only. */
export class LocalEffects {
 private candidates=new Map<string,Candidate>();private scanning?:Promise<LocalEffectCatalog>;private importing?:Promise<unknown>;
 private root:string;private register:(file:string,name:string)=>Promise<Asset>;private roots:string[];
 constructor(root:string,register:(file:string,name:string)=>Promise<Asset>,roots=[path.join(os.homedir(),'Movies/JianyingPro/User Data/Cache/effect'),path.join(os.homedir(),'Movies/JianyingPro/User Data/Cache/artistEffect')]){this.root=root;this.register=register;this.roots=roots;}
 async scan():Promise<LocalEffectCatalog>{
  if(this.scanning)return this.scanning;
  this.scanning=this.doScan();try{return await this.scanning;}finally{this.scanning=undefined;}
 }
 private async doScan():Promise<LocalEffectCatalog>{
  const next=new Map<string,Candidate>();let missingRoots=0;
  for(const root of this.roots){
   let ids;try{ids=await fs.readdir(root,{withFileTypes:true});}catch{missingRoots++;continue;}
   for(const id of ids.filter(e=>e.isDirectory()&&/^\d+$/.test(e.name)).slice(0,2000)){
    const base=path.join(root,id.name),versions=await fs.readdir(base,{withFileTypes:true});
    for(const version of versions.filter(e=>e.isDirectory()&&/^[a-zA-Z0-9_-]{1,100}$/.test(e.name)).slice(0,10)){
     const directory=path.join(base,version.name),key=createHash('sha256').update(directory).digest('hex');
     try{
      const config=JSON.parse((await this.read(directory,'config.json',1048576)).toString('utf8')),known=(reviewed as Record<string,any>)[id.name];
      const isFont=!!(await fs.readdir(directory)).find(f=>/\.(ttf|otf)$/i.test(f));
      const entry:LocalEffect={key,resourceId:id.name,name:known?.name||`本地资源 ${id.name}`,category:isFont?'font':known?.category||'other',available:false,paid:id.name==='12453543'?'observed-paid':'unknown',reason:isFont?'字体单独管理，预览子集不作为完整特效导入':'依赖原生脚本、模型或尚未适配的材质'};
      if(known){
       const matches=await this.verify(directory,known.files);entry.available=matches;
       entry.reason=matches?known.reason:'资源缺失或与已审定版本不一致';if(known.animation)entry.animation=known.animation;
      }
      // A readable config alone never enables an adapter.
      check(config&&typeof config==='object','LOCAL_EFFECT_CONFIG_INVALID');next.set(key,{entry,directory,files:known?.files});
     }catch{/* incomplete/unsafe cache entries are not usable resources */}
    }
   }
  }
  this.candidates=next;return {entries:[...next.values()].map(c=>c.entry).sort((a,b)=>Number(b.available)-Number(a.available)||a.category.localeCompare(b.category)||a.resourceId.localeCompare(b.resourceId)),scannedAt:new Date().toISOString(),missingRoots};
 }
 private async read(directory:string,relative:string,limit=16777216):Promise<Buffer>{
  check(!path.isAbsolute(relative)&&relative.split(/[\\/]/).every(p=>p&&p!=='.'&&p!=='..'),'LOCAL_EFFECT_PATH_REJECTED');
  const file=path.join(directory,relative),realRoot=await fs.realpath(directory),realFile=await fs.realpath(file);
  check(realFile.startsWith(realRoot+path.sep),'LOCAL_EFFECT_PATH_REJECTED');
  const stat=await fs.lstat(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit,'LOCAL_EFFECT_FILE_REJECTED');
  return fs.readFile(file);
 }
 private async verify(directory:string,files:Record<string,string>):Promise<boolean>{
  try{for(const [relative,sha] of Object.entries(files))if(createHash('sha256').update(await this.read(directory,relative)).digest('hex')!==sha)return false;return Object.keys(files).length>0;}catch{return false;}
 }
 async import(key:unknown){
  check(typeof key==='string'&&/^[a-f0-9]{64}$/.test(key),'LOCAL_EFFECT_NOT_FOUND');
  // One import at a time bounds local media work and avoids duplicate registrations.
  check(!this.importing,'LOCAL_EFFECT_BUSY');const task=this.doImport(key);this.importing=task;
  try{return await task;}finally{this.importing=undefined;}
 }
 private async doImport(key:string){
  await this.scan();const candidate=this.candidates.get(key);check(candidate,'LOCAL_EFFECT_NOT_FOUND');
  const {entry,directory,files}=candidate;check(entry.available&&files&&await this.verify(directory,files),'LOCAL_EFFECT_UNAVAILABLE');
  if(entry.animation)return {entry,animation:entry.animation};
  const temporary=path.join(this.root,'media','.effect-'+randomUUID());await fs.mkdir(temporary,{recursive:true});
  try{
   // Copy, then recheck immutable snapshot before conversion; changing caches
   // cannot replace reviewed pixels between scanning and import.
   for(const [relative,sha] of Object.entries(files)){
    const bytes=await this.read(directory,relative);check(createHash('sha256').update(bytes).digest('hex')===sha,'LOCAL_EFFECT_CHANGED');
    const target=path.join(temporary,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});
   }
   let file:string,name:string;
   if(entry.category==='sticker'){file=path.join(temporary,'singleImage.png');name=entry.name+'.png';}
   else{
    check(entry.category==='sequence','LOCAL_EFFECT_UNAVAILABLE');
    file=path.join(temporary,'sequence.mov');name=entry.name+'.mov';
    await runProcess(ffmpeg(),['-v','error','-nostdin','-y','-threads','1','-framerate','25','-start_number','0','-i','GESticker_FullScreenSticker/generalEffect/resource1/texture/a%d.png','-frames:v','96','-vf','scale=1280:720:flags=bilinear,setparams=color_trc=iec61966-2-1:color_primaries=bt709:colorspace=0:range=full','-c:v','png','-pix_fmt','rgba','-color_trc','iec61966-2-1','-color_primaries','bt709','-colorspace','0','-color_range','pc','sequence.mov'],{cwd:temporary,timeout:60000});
   }
   const asset=await this.register(file,name),receipt={adapter:'local-effects-v1',resourceId:entry.resourceId,paid:entry.paid,sourceFiles:files,assetId:asset.id,sha256:await fileHash(file),createdAt:new Date().toISOString(),verification:entry.reason};
   const receipts=path.join(this.root,'effect-imports');await fs.mkdir(receipts,{recursive:true});
   const record=path.join(receipts,asset.id+'.json'),temp=record+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(receipt,null,2),{mode:0o600});await fs.rename(temp,record);
   return {entry,asset};
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
 }
}
