import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {Store} from './store.ts';import {check,validRational} from '../../packages/core/src/document.ts';import type {Document} from '../../packages/core/src/document.ts';
import {selectedClip,freezeCommand,reverseReplacement} from '../../packages/core/src/timeline-tools.ts';
import {sourceTimeAt} from '../../packages/core/src/animation.ts';import {add,compare,ZERO} from '../../packages/core/src/time.ts';import type {Rational} from '../../packages/core/src/time.ts';
import {assertNoClipTransitions} from '../../packages/core/src/transitions.ts';import {freezeMedia,reverseMedia} from '../../packages/media/src/clip-media.ts';import {probeAsset} from '../../packages/media/src/probe.ts';
export type MediaOperation={clipId:string;at?:Rational};
export function validateMediaOperation(document:Document,kind:'freeze'|'reverse',operation:MediaOperation){
 check(typeof operation.clipId==='string'&&operation.clipId.length>0,'INVALID_CLIP_ID');if(kind==='freeze')validRational(operation.at,'freeze.at');
 const {track,clip,asset}=selectedClip(document,operation.clipId);check(!track.locked,'TRACK_LOCKED');check(clip.editableTiming,'TIMING_NOT_INTERPRETED');check((asset.kind||'video')==='video'&&asset.verifiedDisplayTransform!=='unsupported','MEDIA_OPERATION_UNSUPPORTED');assertNoClipTransitions(document,clip.id);
 if(kind==='freeze'){check(operation.at&&compare(operation.at,clip.target.start)>=0&&compare(operation.at,add(clip.target.start,clip.target.duration))<0,'FREEZE_OUTSIDE_CLIP');check(!clip.textAnimations?.length,'TEXT_ANIMATION_TIMING_EDIT_UNVERIFIED');}
 else check(compare(sourceTimeAt(clip,add(clip.target.start,clip.target.duration)),add(clip.source.start,clip.source.duration))<=0,'REVERSE_CURVE_RANGE_UNSUPPORTED');
 return {track,clip,asset};
}
export async function prepareMediaOperation(store:Store,document:Document,kind:'freeze'|'reverse',operation:MediaOperation,directory:string,options:{signal?:AbortSignal;onProgress?:(n:number)=>void}={}){
 const {clip,asset}=validateMediaOperation(document,kind,operation),file=kind==='freeze'?await freezeMedia(asset,sourceTimeAt(clip,operation.at!),directory,options):await reverseMedia(asset,clip.source.start,clip.source.duration,directory,options);
 const derived=await probeAsset(file,(asset.name||'视频')+(kind==='freeze'?' · 定格.png':' · 倒放.mp4'));
 const existing=store.assets.get(derived.id);if(existing)Object.assign(derived,existing);else{const destination=path.join(store.root,'media',derived.id+(kind==='freeze'?'.png':'.mp4'));await fs.copyFile(file,destination);derived.path=destination;}
 await store.addAsset(derived);const registered=store.assets.get(derived.id)!;
 const clipId=kind==='freeze'?randomUUID():clip.id;
 const command=kind==='freeze'?freezeCommand(document,clip.id,operation.at!,registered,clipId,randomUUID()):{type:'batch' as const,commands:[...(!document.assets.some(a=>a.id===registered.id)?[{type:'asset.add' as const,asset:registered}]:[]),{type:'clip.replace' as const,clipId:clip.id,clip:reverseReplacement(clip,registered)}]};
 return {assetId:registered.id,clipId,command};
}
