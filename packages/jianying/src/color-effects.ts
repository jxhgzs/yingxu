import type {Vignette} from '../../core/src/vignette.ts';
import type {ColorAdjustments} from '../../core/src/color-effects.ts';
type Raw=Record<string,any>;
const keys=new Set(['adjust_params','algorithm_artifact_path','apply_target_type','bloom_params','category_id','category_name','color_match_info','effect_id','enable_skin_tone_correction','exclusion_group','face_adjust_params','formula_id','id','intensity_key','multi_language_current','name','panel_id','path','platform','request_id','resource_id','source_platform','sub_type','time_range','type','value','version']);
/** Fixed 5.9.0 combine resource and explicitly runtime-observed parameter versions. */
export function isKnownColorAdjustment(v:Raw):boolean{
 return isKnownEffect(v,false);
}
export function isKnownVignette(v:Raw):boolean{return isKnownEffect(v,true);}
function isKnownEffect(v:Raw,spatial:boolean):boolean{
 if(!v||typeof v!=='object'||Object.keys(v).some(k=>!keys.has(k)))return false;
 const versions:Record<string,string>={brightness:'v2',contrast:'v3',saturation:'v1',highlight:'v3',shadow:'v3',temperature:'v3',tone:'v3',black:'',white:'',fade:''};
 if((spatial?v.type!=='vignetting'||v.version!=='v1':!(v.type in versions)||v.version!==versions[v.type])||!Number.isFinite(v.value)||Math.abs(v.value)>1||v.type==='fade'&&v.value<0)return false;
 // The retained native corpus writes manual_zoom on temperature/tone and
 // black/white records. Only those four observed types accept this spelling.
 const knownSubtype=v.sub_type==='none'||(v.sub_type==='manual_zoom'&&['temperature','tone','black','white'].includes(v.type));
 if(typeof v.path!=='string'||!v.path.replaceAll('\\','/').endsWith('/Resources/DefaultAdjustBundle/'+(spatial?'vignetting_v1':'combine_adjust'))||v.platform!=='all'||!knownSubtype||v.apply_target_type!==0||v.source_platform!==0||v.enable_skin_tone_correction!==false||v.bloom_params!==null||v.time_range!==null)return false;
 for(const key of ['adjust_params','exclusion_group','face_adjust_params'])if(!Array.isArray(v[key])||v[key].length)return false;
 for(const key of ['algorithm_artifact_path','category_id','category_name','effect_id','formula_id','intensity_key','multi_language_current','name','panel_id','request_id','resource_id'])if(v[key]!=='')return false;
 if(!v.color_match_info||Object.keys(v.color_match_info).length!==3||['source_feature_path','target_feature_path','target_image_path'].some(k=>v.color_match_info[k]!==''))return false;
 return typeof v.id==='string'&&v.id.length>0;
}
export function importColorAdjustments(segment:Raw,materials:Raw):{colorAdjustments?:ColorAdjustments;vignette?:Vignette;diagnostic?:string}{
 const effects=(materials.effects||[]).filter((e:Raw)=>segment.extra_material_refs?.includes(e.id));if(!effects.length)return {};
 const values:ColorAdjustments={version:'combine-adjust-v2'},types=new Set<string>();let vignette:Vignette|undefined;
 for(const effect of effects){if(effect.type==='vignetting'){if(vignette||!isKnownEffect(effect,true))return {diagnostic:'COLOR_ADJUSTMENTS_NOT_INTERPRETED'};vignette={version:'v1',intensity:effect.value};continue;}if(!isKnownColorAdjustment(effect)||types.has(effect.type))return {diagnostic:'COLOR_ADJUSTMENTS_NOT_INTERPRETED'};types.add(effect.type);const field=effect.type==='tone'?'tint':effect.type;values[field as 'brightness'|'contrast'|'saturation'|'highlight'|'shadow'|'temperature'|'tint'|'black'|'white'|'fade']=effect.value;}
 return {...(types.size?{colorAdjustments:values}:{}),...(vignette?{vignette}:{})};
}
