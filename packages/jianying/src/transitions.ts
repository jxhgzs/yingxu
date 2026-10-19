import type {Diagnostic,Document,Transition} from '../../core/src/document.ts';
import {validateTransitions} from '../../core/src/transitions.ts';
import {micros,compare} from '../../core/src/time.ts';
type Raw=Record<string,any>;

// Identity observed in 5.9.0's real UI add/set-duration snapshots 04/05/06.
// The resource is identified but never loaded or copied by this adapter.
const dissolve={resourceId:'6724845717472416269',effectId:'322577',name:'叠化',pathSuffix:'/effect/322577/2d641adc4bb63e37e3a0067d8c8cc3c3'};
const flashBlack={resourceId:'6724239388189921806',effectId:'321493',name:'闪黑',pathSuffix:'/effect/321493/3bca53e9f3dfa2c184fbee96438ea097'};
const fields=new Set(['category_id','category_name','duration','effect_id','id','is_overlap','name','path','platform','request_id','resource_id','type']);
export function isKnownTransitionMaterial(value:unknown):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Raw,identity=v.is_overlap===true?dissolve:v.is_overlap===false?flashBlack:undefined;
  if(!identity)return false;
  return Object.keys(v).every(k=>fields.has(k))&&v.type==='transition'&&
    typeof v.id==='string'&&v.id.length>0&&v.id.length<=200&&Number.isSafeInteger(v.duration)&&v.duration>0&&
    v.resource_id===identity.resourceId&&v.effect_id===identity.effectId&&v.name===identity.name&&
    typeof v.path==='string'&&v.path.replaceAll('\\','/').endsWith(identity.pathSuffix);
}

export function importNativeTransitions(input:Raw,doc:Document):{transitions:Transition[];diagnostics:Diagnostic[];blockedClipIds:Set<string>} {
  const materials=Array.isArray(input.materials?.transitions)?input.materials.transitions:[];
  const transitions:Transition[]=[],diagnostics:Diagnostic[]=[],blockedClipIds=new Set<string>();
  for(const rawTrack of input.tracks||[]){
    const track=doc.tracks.find(t=>t.id===rawTrack.id);if(!track)continue;
    const ordered=[...track.clips].sort((a,b)=>compare(a.target.start,b.target.start));
    for(const segment of rawTrack.segments||[]){
      const refs=Array.isArray(segment.extra_material_refs)?segment.extra_material_refs:[];
      const selected=materials.filter((m:Raw)=>m&&refs.includes(m.id));if(!selected.length)continue;
      const index=ordered.findIndex(c=>c.id===segment.id),incoming=ordered[index+1];
      const fail=(code:string)=>{diagnostics.push({code,trackId:track.id,clipId:segment.id});blockedClipIds.add(segment.id);if(incoming)blockedClipIds.add(incoming.id);};
      if(selected.length!==1||!isKnownTransitionMaterial(selected[0])){fail('TRANSITION_UNSUPPORTED');continue;}
      const material=selected[0];
      const transition:Transition={id:material.id,trackId:track.id,outgoingClipId:segment.id,incomingClipId:incoming?.id||'',kind:material.is_overlap?'crossfade':'dipToBlack',alignment:'center',overlap:material.is_overlap,duration:micros(material.duration)};
      try{validateTransitions({...doc,transitions:[...transitions,transition]});transitions.push(transition);}
      catch(error){fail(error instanceof Error?error.message.split(':')[0]:'TRANSITION_UNSUPPORTED');}
    }
  }
  // A neighbouring unknown transition can affect the same pair; keep that region closed.
  const supported=transitions.filter(t=>{
    if(!blockedClipIds.has(t.outgoingClipId)&&!blockedClipIds.has(t.incomingClipId))return true;
    diagnostics.push({code:'TRANSITION_TIME_MAPPING_UNSUPPORTED',trackId:t.trackId,clipId:t.outgoingClipId});return false;
  });
  return {transitions:supported,diagnostics,blockedClipIds};
}
