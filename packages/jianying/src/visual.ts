import {defaultTransform} from '../../core/src/document.ts';
import type {Transform} from '../../core/src/document.ts';

type Raw=Record<string,any>;
const blank=(v:unknown)=>v==null||v==='';
const empty=(v:unknown)=>v==null||Array.isArray(v)&&v.length===0;

/** A deliberately narrow allowlist of default video state present in the real snapshots. */
export function importKnownVideoVisual(segment:Raw,material:Raw,materials:Raw,knownCurve=false,knownFade=false):{transform:Transform;volume:number}|undefined {
  const clip=segment.clip,scale=clip?.scale;
  if(!clip||clip.alpha!==1||clip.rotation!==0||clip.transform?.x!==0||clip.transform?.y!==0||
    clip.flip?.horizontal!==false||clip.flip?.vertical!==false||segment.uniform_scale?.on!==true||segment.uniform_scale.value!==1||
    !scale||!Number.isFinite(scale.x)||scale.x!==scale.y||scale.x<.01||scale.x>10||segment.volume!==1)return;
  if(segment.reverse!==false||segment.visible!==true||segment.responsive_layout?.enable!==false||
    segment.is_placeholder!==false||segment.is_tone_modify!==false||segment.intensifies_audio!==false||
    segment.cartoon!==false||!empty(segment.keyframe_refs)||!blank(segment.template_id))return;
  if(!segment.hdr_settings||segment.hdr_settings.mode!==1||segment.hdr_settings.intensity!==1||segment.hdr_settings.nits!==1000)return;
  if(material.type!=='video'||material.freeze!=null||material.audio_fade!=null&&!knownFade||
    !blank(material.reverse_path)||!blank(material.reverse_intensifies_path)||!blank(material.intensifies_path)||
    !blank(material.intensifies_audio_path)||material.smart_motion!=null||material.object_locked!=null)return;
  if(material.audio_fade!=null){
    const nested=material.audio_fade,fade=Array.isArray(materials.audio_fades)?materials.audio_fades.find((v:Raw)=>v?.id===nested.id&&segment.extra_material_refs?.includes(v.id)):undefined;
    if(!fade||['id','type','fade_type','fade_in_duration','fade_out_duration'].some(key=>nested[key]!==fade[key]))return;
  }
  const crop=material.crop;
  if(!crop||crop.upper_left_x!==0||crop.upper_left_y!==0||crop.upper_right_x!==1||crop.upper_right_y!==0||
    crop.lower_left_x!==0||crop.lower_left_y!==1||crop.lower_right_x!==1||crop.lower_right_y!==1||material.crop_scale!==1)return;
  const algorithm=material.video_algorithm;
  if(!algorithm||!empty(algorithm.algorithms)||Object.entries(algorithm).some(([k,v])=>['algorithms','gameplay_configs'].includes(k)?!empty(v):k==='path'?!blank(v):v!=null))return;
  if(!material.matting||material.matting.flag!==0||!blank(material.matting.path)||!empty(material.matting.strokes)||
    material.matting.has_use_quick_brush!==false||material.matting.has_use_quick_eraser!==false||!empty(material.matting.interactiveTime)||
    !material.stable||material.stable.stable_level!==0||!blank(material.stable.matrix_path))return;
  if(!Array.isArray(segment.extra_material_refs))return;
  const known:Record<string,(v:Raw)=>boolean>={
    speeds:v=>v.type==='speed'&&v.speed===segment.speed&&(v.curve_speed===null&&v.mode===0||knownCurve&&v.mode===1&&v.curve_speed!=null),
    canvases:v=>v.type==='canvas_color'&&v.blur===0&&blank(v.color)&&blank(v.image)&&blank(v.image_id)&&blank(v.album_image),
    sound_channel_mappings:v=>v.audio_channel_mapping===0&&v.is_config_open===false&&blank(v.type),
    vocal_separations:v=>v.type==='vocal_separation'&&v.choice===0&&blank(v.production_path)&&v.time_range===null,
    audio_fades:v=>knownFade&&v.type==='audio_fade'&&v.fade_type===0,
    material_animations:v=>v.type==='sticker_animation'&&Array.isArray(v.animations)&&v.animations.length===0&&v.multi_language_current==='none',
  };
  for(const ref of segment.extra_material_refs){
    const matches=Object.entries(materials).flatMap(([kind,values])=>Array.isArray(values)?values.filter(v=>v&&v.id===ref).map(v=>({kind,value:v})):[]);
    if(matches.length!==1||!known[matches[0].kind]?.(matches[0].value))return;
  }
  return {transform:{...defaultTransform(),scale:scale.x},volume:1};
}
