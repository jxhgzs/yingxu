import {check,validRational} from './document.ts';import {compare,ZERO,rational} from './time.ts';import type {Rational} from './time.ts';
export type Marker={id:string;time:Rational;title:string;color:string};
export function validateMarkers(markers:Marker[],limit=rational(3600)){
 check(Array.isArray(markers)&&markers.length<=1000,'INVALID_MARKER');const ids=new Set<string>();
 for(const m of markers){check(m&&typeof m.id==='string'&&m.id.length>0&&m.id.length<=200&&!ids.has(m.id)&&typeof m.title==='string'&&m.title.length<=100&&/^#[0-9a-f]{6}$/i.test(m.color),'INVALID_MARKER');validRational(m.time,'marker');check(compare(m.time,ZERO)>=0&&compare(m.time,limit)<=0,'INVALID_MARKER');ids.add(m.id);}
}
