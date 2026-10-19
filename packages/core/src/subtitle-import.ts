import {validateDocument,validRational,check,defaultTransform} from './document.ts';
import type {Document,Track,TextStyle} from './document.ts';
import {rational,add,compare,ZERO} from './time.ts';
import type {Rational} from './time.ts';
import {SUBTITLE_LIMITS} from './subtitles.ts';
import type {ParsedSubtitles,SubtitleDiagnostic} from './subtitles.ts';

export type SubtitleImportOptions={idPrefix:string;name?:string;offset?:Rational;style?:Partial<Omit<TextStyle,'content'>>};
export type SubtitleImportResult={document:Document;clipIds:string[];trackIds:string[];diagnostics:SubtitleDiagnostic[]};

/** Builds all subtitle clips in one clone and validates once; the caller commits one history revision. */
export function applySubtitleImport(doc:Document,parsed:ParsedSubtitles,options:SubtitleImportOptions):SubtitleImportResult{
  validateDocument(doc);
  check(options&&typeof options==='object'&&Object.keys(options).every(k=>['idPrefix','name','offset','style'].includes(k)),'SUBTITLE_INVALID_OPTIONS');
  check(typeof options.idPrefix==='string'&&/^[\w-]{1,100}$/.test(options.idPrefix),'SUBTITLE_INVALID_ID_PREFIX');
  const name=options.name??'导入字幕';check(typeof name==='string'&&name.length>0&&name.length<=90,'SUBTITLE_INVALID_NAME');
  const offset=options.offset??ZERO;validRational(offset,'subtitle.offset');
  const style=options.style??{};
  check(style&&typeof style==='object'&&Object.keys(style).every(k=>['size','font','color','outline','shadow','lineHeight'].includes(k)),'SUBTITLE_INVALID_STYLE');
  // libass normalizes this font by winAscent+winDescent (1412), rather than UPM (1000).
  // Keep the observed multiline baseline spacing independent of that glyph scaling.
  const textStyle={...(parsed?.format==='srt'?{size:Math.max(8,doc.canvas.height*.05*1.412),font:'Source Han Sans SC Medium',outline:0,shadow:0,lineHeight:doc.canvas.height*38/720}:
    {size:Math.max(8,Math.round(doc.canvas.height*.06)),font:'PingFang SC'}),color:'#ffffff',...style};
  check(parsed&&(parsed.format==='srt'||parsed.format==='vtt')&&typeof parsed.sourceText==='string'&&new TextEncoder().encode(parsed.sourceText).length<=SUBTITLE_LIMITS.bytes&&Array.isArray(parsed.cues)&&parsed.cues.length>0&&parsed.cues.length<=SUBTITLE_LIMITS.cues&&Array.isArray(parsed.diagnostics),'SUBTITLE_INVALID_PARSE_RESULT');
  const indexes=new Set<number>();
  for(const c of parsed.cues){
    check(c&&Number.isSafeInteger(c.index)&&c.index>0&&!indexes.has(c.index)&&typeof c.text==='string'&&c.text.trim().length>0&&c.text.length<=SUBTITLE_LIMITS.text,'SUBTITLE_INVALID_CUE');indexes.add(c.index);
    validRational(c.start);validRational(c.duration);
    check(compare(c.start,ZERO)>=0&&compare(c.duration,ZERO)>0,'SUBTITLE_INVALID_CUE');
    check(compare(add(c.start,offset),ZERO)>=0,'SUBTITLE_NEGATIVE_START');
  }
  for(const d of parsed.diagnostics)check(d&&typeof d.code==='string'&&typeof d.message==='string'&&['info','warning'].includes(d.severity),'SUBTITLE_INVALID_DIAGNOSTIC');
  const occupied=new Set([...doc.assets.map(a=>a.id),...doc.tracks.map(t=>t.id),...doc.tracks.flatMap(t=>t.clips.map(c=>c.id)),...(doc.subtitleSources||[]).map(s=>s.id)]);
  const reserve=(id:string)=>{check(!occupied.has(id),'SUBTITLE_ID_COLLISION',id);occupied.add(id);return id;};
  const materialId=reserve(options.idPrefix+'-asset'),next=structuredClone(doc),tracks:Track[]=[],ends:Rational[]=[],clipIds:string[]=[];
  const cues=[...parsed.cues].sort((a,b)=>compare(a.start,b.start)||a.index-b.index);
  const maxLines=Math.max(...cues.map(c=>c.text.split('\n').length)),lineHeight=textStyle.lineHeight??textStyle.size*1.3,slotHeight=maxLines*lineHeight;
  let longest=ZERO;
  for(const cue of cues){
    const start=add(cue.start,offset);let lane=ends.findIndex(end=>compare(end,start)<=0);
    const isSrt=parsed.format==='srt';
    if(lane<0){
      lane=ends.length;
      check(doc.tracks.length+lane+1<=500,'SUBTITLE_TRACK_LIMIT');
      tracks.push({id:reserve(options.idPrefix+'-track-'+lane),kind:'text',name:lane?`${name} ${lane+1}`:name,clips:[]});
    }
    const currentSlotHeight=isSrt?cue.text.split('\n').length*lineHeight:slotHeight;
    const center=isSrt?doc.canvas.height*(9-lane)/10:doc.canvas.height*.82-lane*slotHeight;
    check(center-currentSlotHeight/2>=doc.canvas.height*.05&&center+currentSlotHeight/2<=doc.canvas.height*.98,'SUBTITLE_LAYOUT_OVERFLOW');
    ends[lane]=add(start,cue.duration);if(compare(cue.duration,longest)>0)longest=cue.duration;
    const id=reserve(options.idPrefix+'-cue-'+cue.index);clipIds.push(id);
    tracks[lane].clips.push({id,materialId,source:{start:ZERO,duration:structuredClone(cue.duration)},target:{start,duration:structuredClone(cue.duration)},speed:rational(1),editableTiming:true,
      transform:{...defaultTransform(),y:isSrt?doc.canvas.height*(4-lane)/10:Math.round(doc.canvas.height*.32-lane*slotHeight)},text:{...textStyle,content:cue.text}});
  }
  next.assets.push({id:materialId,path:'',kind:'text',name,duration:structuredClone(longest)});next.tracks.push(...tracks);
  next.subtitleSources=[...(next.subtitleSources||[]),{id:reserve(options.idPrefix+'-source'),assetId:materialId,name,format:parsed.format,text:parsed.sourceText}];
  validateDocument(next);
  const diagnostics=structuredClone(parsed.diagnostics);
  if(tracks.length>1)diagnostics.push({code:'SUBTITLE_OVERLAP_LANES',severity:'warning',message:`重叠字幕已分配到${tracks.length}条文字轨并向上分层。`});
  return {document:next,clipIds,trackIds:tracks.map(t=>t.id),diagnostics};
}
