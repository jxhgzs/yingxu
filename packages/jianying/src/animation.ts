import {check} from '../../core/src/document.ts';
import {validateAnimations} from '../../core/src/animation.ts';
import type {Animation, Keyframe} from '../../core/src/animation.ts';
import {compare, micros} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';

type ScaleImport = {animations?:Animation[]; diagnostic?:string};
const record=(v:unknown):v is Record<string,any> => !!v&&typeof v==='object'&&!Array.isArray(v);
const zeroControl=(v:unknown) => record(v)&&v.x===0&&v.y===0;

/** Only the source-clock, linear uniform scale demonstrated by the 5.9.0 snapshots. */
export function importScaleAnimations(segment:Record<string,any>, materialDuration:Rational):ScaleImport {
  const curves=segment.common_keyframes;
  if(curves==null)return {};
  check(Array.isArray(curves),'INVALID_JSON_STRUCTURE','common_keyframes');
  if(!curves.length)return {};
  if(curves.some(c=>!record(c)||!['KFTypeScaleX','KFTypeScaleY'].includes(c.property_type)))
    return {diagnostic:'KEYFRAME_PROPERTY_UNSUPPORTED'};
  const x=curves.filter(c=>c.property_type==='KFTypeScaleX'),y=curves.filter(c=>c.property_type==='KFTypeScaleY');
  if(x.length!==1||y.length>1)return {diagnostic:'KEYFRAME_SCALE_SEMANTICS_UNSUPPORTED'};
  const scale=segment.clip?.scale;
  if(segment.uniform_scale?.on!==true||segment.uniform_scale.value!==1||!record(scale)||!Number.isFinite(scale.x)||scale.x!==scale.y)
    return {diagnostic:'KEYFRAME_SCALE_SEMANTICS_UNSUPPORTED'};
  let unsupportedInterpolation=false;
  const parse=(curve:Record<string,any>):Keyframe[]=>{
    check(Array.isArray(curve.keyframe_list),'INVALID_JSON_STRUCTURE','keyframe_list');
    if(curve.material_id!=='')unsupportedInterpolation=true;
    const points=curve.keyframe_list.map((p:unknown):Keyframe=>{
      check(record(p),'INVALID_JSON_STRUCTURE','keyframe');
      check(Number.isSafeInteger(p.time_offset),'INVALID_KEYFRAME_TIME');
      check(Array.isArray(p.values)&&p.values.length===1&&typeof p.values[0]==='number','INVALID_KEYFRAME');
      if(p.curveType!=='Line'||p.graphID!==''||!zeroControl(p.left_control)||!zeroControl(p.right_control))unsupportedInterpolation=true;
      return {id:p.id,time:micros(p.time_offset),value:p.values[0],interpolation:'linear'};
    });
    // This also rejects duplicate/reversed times, duplicate IDs and points beyond the asset.
    // Points outside the clip remain valid and can influence its visible interpolation.
    validateAnimations([{property:'scale',points}],materialDuration);
    return points;
  };
  const points=parse(x[0]), yPoints=y.length?parse(y[0]):undefined;
  if(unsupportedInterpolation)return {diagnostic:'KEYFRAME_INTERPOLATION_UNSUPPORTED'};
  if(yPoints&&(yPoints.length!==points.length||points.some((p,i)=>compare(p.time,yPoints[i].time)!==0||p.value!==yPoints[i].value)))
    return {diagnostic:'KEYFRAME_SCALE_SEMANTICS_UNSUPPORTED'};
  return {animations:[{property:'scale',points}]};
}
