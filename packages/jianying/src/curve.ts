import {validateSpeedCurve,curveAverageSpeed} from '../../core/src/curve-speed.ts';
import type {SpeedCurve} from '../../core/src/curve-speed.ts';
/** Admit only the point-based mode whose clock has native evidence; retain every other source unchanged. */
export function importKnownSpeedCurve(segment:Record<string,any>,materials:Record<string,any>):{curve?:SpeedCurve;diagnostic?:string}{
 const refs=Array.isArray(segment.extra_material_refs)?segment.extra_material_refs:[],speeds=materials.speeds;
 if(!Array.isArray(speeds))return {diagnostic:'CURVE_SPEED_UNSUPPORTED'};
 const selected=speeds.filter(s=>s&&refs.includes(s.id));
 const curves=selected.filter(s=>s.curve_speed!=null);
 if(!curves.length)return {};
 if(selected.length!==1||curves.length!==1)return {diagnostic:'CURVE_SPEED_UNSUPPORTED'};
 const speed=curves[0],raw=speed.curve_speed;
 if(speed.mode!==1||speed.type!=='speed'||!raw||!Array.isArray(raw.speed_points))return {diagnostic:'CURVE_SPEED_UNSUPPORTED'};
 const curve:SpeedCurve={points:raw.speed_points.map((p:any)=>({x:p?.x,y:p?.y}))};
 try{
  validateSpeedCurve(curve);const average=curveAverageSpeed(curve);
  if(!Number.isFinite(speed.speed)||!Number.isFinite(segment.speed)||Math.abs(speed.speed-average)>1e-6||Math.abs(segment.speed-average)>1e-6)return {diagnostic:'CURVE_SPEED_AVERAGE_MISMATCH'};
 }catch{return {diagnostic:'CURVE_SPEED_UNSUPPORTED'};}
 return {curve};
}
