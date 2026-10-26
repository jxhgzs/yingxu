import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {Store} from './store.ts';import type {Document} from '../../packages/core/src/document.ts';
import {selectedClip,freezeCommand,reverseReplacement} from '../../packages/core/src/timeline-tools.ts';
import {sourceTimeAt} from '../../packages/core/src/animation.ts';import type {Rational} from '../../packages/core/src/time.ts';
import {freezeMedia,reverseMedia} from '../../packages/media/src/clip-media.ts';import {probeAsset} from '../../packages/media/src/probe.ts';
export type MediaOperation={clipId:string;at?:Rational};
export {validateMediaTool as validateMediaOperation} from '../../packages/core/src/tool-availability.ts';
import {validateMediaTool as validateMediaOperation} from '../../packages/core/src/tool-availability.ts';
export async function prepareMediaOperation(store:Store,document:Document,kind:'freeze'|'reverse',operation:MediaOperation,directory:string,options:{signal?:AbortSignal;onProgress?:(n:number)=>void}={}){
 const {clip,asset}=validateMediaOperation(document,kind,operation),file=kind==='freeze'?await freezeMedia(asset,sourceTimeAt(clip,operation.at!),directory,options):await reverseMedia(asset,clip.source.start,clip.source.duration,directory,options);
 const derived=await probeAsset(file,(asset.name||'视频')+(kind==='freeze'?' · 定格.png':' · 倒放.mp4'));
 const existing=store.assets.get(derived.id);if(existing)Object.assign(derived,existing);else{const destination=path.join(store.root,'media',derived.id+(kind==='freeze'?'.png':'.mp4'));await fs.copyFile(file,destination);derived.path=destination;}
 await store.addAsset(derived);const registered=store.assets.get(derived.id)!;
 const clipId=kind==='freeze'?randomUUID():clip.id;
 const command=kind==='freeze'?freezeCommand(document,clip.id,operation.at!,registered,clipId,randomUUID()):{type:'batch' as const,commands:[...(!document.assets.some(a=>a.id===registered.id)?[{type:'asset.add' as const,asset:registered}]:[]),{type:'clip.replace' as const,clipId:clip.id,clip:reverseReplacement(clip,registered)}]};
 return {assetId:registered.id,clipId,command};
}
