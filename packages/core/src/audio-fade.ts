import type {Clip} from './document.ts';
import type {Rational} from './time.ts';
import {compare} from './time.ts';
export type AudioFade={curve:'qsin';inDuration:Rational;outDuration:Rational};
/** Time edits cap retained fades to the explicit target duration; never scale them by speed. */
export function clampAudioFade(clip:Clip):void{
 if(!clip.audioFade)return;
 for(const key of ['inDuration','outDuration'] as const)if(compare(clip.audioFade[key],clip.target.duration)>0)clip.audioFade[key]=structuredClone(clip.target.duration);
}
