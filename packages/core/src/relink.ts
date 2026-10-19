import {check,validateDocument} from './document.ts';
import type {Asset,Document} from './document.ts';
import {add,compare} from './time.ts';

export type AssetRelinkInput={assetId:string;replacement:Asset};
function sameIdentity(a:Asset,b:Asset):boolean{
  return a.id===b.id&&a.path===b.path&&a.sha256===b.sha256&&(a.kind||'video')===(b.kind||'video')&&
    compare(a.duration,b.duration)===0&&a.width===b.width&&a.height===b.height&&a.hasAudio===b.hasAudio&&a.mime===b.mime&&
    (['matrix','primaries','transfer','range'] as const).every(k=>a.colorSpace?.[k]===b.colorSpace?.[k])&&
    (a.fps===undefined&&b.fps===undefined||a.fps!==undefined&&b.fps!==undefined&&compare(a.fps,b.fps)===0);
}
/** Pure document edit: paths are data only; the service must supply canonical registered replacement data. */
export function applyAssetRelink(doc:Document,input:AssetRelinkInput):Document{
  validateDocument(doc);
  check(input&&typeof input==='object'&&typeof input.assetId==='string','INVALID_RELINK_REQUEST');
  const original=doc.assets.find(a=>a.id===input.assetId);check(original,'RELINK_ASSET_NOT_FOUND',input.assetId);
  const replacement=input.replacement;
  check(replacement&&typeof replacement==='object','INVALID_RELINK_REQUEST');
  // Validate the new record independently without visiting paths or discarding the actual document's metadata.
  validateDocument({schemaVersion:1,canvas:doc.canvas,fps:doc.fps,assets:[replacement],tracks:[]});
  check(original.kind!=='text'&&replacement.kind!=='text','RELINK_TEXT_UNSUPPORTED');
  const mediaGroup=(asset:Asset)=>asset.kind==='audio'?'audio':'video';
  check(mediaGroup(original)===mediaGroup(replacement),'RELINK_KIND_MISMATCH');
  const existing=doc.assets.find(a=>a.id===replacement.id);
  if(existing)check(sameIdentity(existing,replacement),'RELINK_ID_CONFLICT',replacement.id);
  for(const track of doc.tracks)for(const clip of track.clips)if(clip.materialId===original.id){
    check(!track.locked,'TRACK_LOCKED',track.id);
    check(clip.editableTiming,'TIMING_NOT_INTERPRETED',clip.id);
    check(compare(add(clip.source.start,clip.source.duration),replacement.duration)<=0,'SOURCE_RANGE_EXCEEDED',clip.id);
    for(const animation of clip.animations||[])for(const point of animation.points)
      check(compare(point.time,replacement.duration)<=0,'KEYFRAME_OUTSIDE_MATERIAL',clip.id);
  }
  const next=structuredClone(doc);
  if(original.id!==replacement.id){
    next.assets=next.assets.filter(a=>a.id!==original.id);
    if(!existing)next.assets.push(structuredClone(replacement));
    for(const track of next.tracks)for(const clip of track.clips)if(clip.materialId===original.id)clip.materialId=replacement.id;
  }
  validateDocument(next);return next;
}
