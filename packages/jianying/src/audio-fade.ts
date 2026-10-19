import type {AudioFade} from '../../core/src/audio-fade.ts';
import {micros} from '../../core/src/time.ts';
type Raw=Record<string,any>;
export function importAudioFade(segment:Raw,materials:Raw):{fade?:AudioFade;diagnostic?:string}{
 const refs=new Set(segment.extra_material_refs||[]),selected=Array.isArray(materials.audio_fades)?materials.audio_fades.filter((v:any)=>v&&refs.has(v.id)):[];
 if(!selected.length)return {};
 const fail=()=>({diagnostic:'AUDIO_FADE_UNSUPPORTED'});
 if(selected.length!==1)return fail();
 const fade=selected[0],duration=segment.target_timerange?.duration;
 if(fade.type!=='audio_fade'||fade.fade_type!==0||!Number.isSafeInteger(duration)||
   ![fade.fade_in_duration,fade.fade_out_duration].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=duration)||fade.fade_in_duration+fade.fade_out_duration>duration)return fail();
 return {fade:{curve:'qsin',inDuration:micros(fade.fade_in_duration),outDuration:micros(fade.fade_out_duration)}};
}
