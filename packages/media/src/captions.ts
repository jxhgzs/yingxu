import type {Layer} from './graph.ts';
import type {Rational} from '../../core/src/time.ts';
import {add,div,mul,rational} from '../../core/src/time.ts';
import {check} from '../../core/src/document.ts';
import {animatedValue} from './animation.ts';

/** Align to the visible output frame first, then floor its ASS centisecond edge. */
export function frameEdge(time:Rational,fps:Rational) {
  const f=mul(time,fps),n=BigInt(f.numerator),d=BigInt(f.denominator),frame=(n+d-1n)/d;
  const edge=div(rational(frame),fps),cs=Number(BigInt(edge.numerator)*100n/BigInt(edge.denominator));
  return {frame:Number(frame),ass:`${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`};
}
function assText(text:string) {
  return text.replace(/\\/g,'\\\u200b').replace(/{/g,'\\{').replace(/}/g,'\\}').replace(/\r?\n/g,'\\N');
}
/** A media layer is a hard boundary: text below it must not move to the top. */
export function groupTextLayers(layers:Layer[]):(Layer|Layer[])[] {
  const result:(Layer|Layer[])[]=[];let pending:Layer[]=[];
  for(const layer of layers){
    if(layer.asset.kind==='text')pending.push(layer);
    else {if(pending.length)result.push(pending);pending=[];result.push(layer);}
  }
  if(pending.length)result.push(pending);return result;
}
export function captionScript(layers:Layer[],canvas:{width:number;height:number},fps:Rational):string {
  const entries=layers.map(({clip},layer)=>{
    const first=frameEdge(clip.target.start,fps),last=frameEdge(add(clip.target.start,clip.target.duration),fps);
    const animated=clip.animations?.some(a=>a.property!=='volume')||false;
    return {clip,layer,first,last,animated};
  }).filter(e=>e.first.frame<e.last.frame);
  if(!entries.length)return '';
  const lineCount=(text:string,lineHeight?:number)=>lineHeight===undefined?1:text.split('\n').length;
  const eventCount=entries.reduce((sum,e)=>sum+(e.animated?e.last.frame-e.first.frame:1)*lineCount(e.clip.text!.content,e.clip.text!.lineHeight),0);
  check(eventCount<=100000,'TEXT_RENDER_EVENT_LIMIT');
  const styles:string[]=[],events:string[]=[];
  for(const {clip,layer,first,last,animated} of entries){
    const t=clip.transform!,style=clip.text!,name=`Caption${layer}`,rgb=style.color.slice(1);
    const color=`&H${Math.round((1-t.opacity)*255).toString(16).padStart(2,'0')}${rgb.slice(4,6)}${rgb.slice(2,4)}${rgb.slice(0,2)}`;
    styles.push(`Style: ${name},${style.font},${style.size},${color},&H000000FF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,${style.outline??1},${style.shadow??1},5,20,20,20,1`);
    const lines=style.lineHeight===undefined?[style.content]:style.content.split('\n');
    for(const [lineIndex,line] of lines.entries()){
      const text=assText(line),lineOffset=(lineIndex-(lines.length-1)/2)*(style.lineHeight??0);
      const position=(x:number,y:number,scale:number,rotation:number)=>{
        const offset=lineOffset*scale,angle=rotation*Math.PI/180;
        return `${canvas.width/2+x-Math.sin(angle)*offset},${canvas.height/2+y+Math.cos(angle)*offset}`;
      };
      if(animated){
      for(let frame=first.frame;frame<last.frame;frame++){
        const time=div(rational(frame),fps),edge=frameEdge(time,fps),end=frameEdge(div(rational(frame+1),fps),fps);
        const value=(property:'x'|'y'|'scale'|'rotation'|'opacity')=>animatedValue(clip,property,time,t[property]);
        const alpha=Math.round((1-value('opacity'))*255).toString(16).padStart(2,'0');
        events.push(`Dialogue: ${layer},${edge.ass},${end.ass},${name},,0,0,0,,{\\pos(${position(value('x'),value('y'),value('scale'),value('rotation'))})\\fscx${value('scale')*100}\\fscy${value('scale')*100}\\frz${-value('rotation')}\\alpha&H${alpha}&}${text}`);
      }
      }else events.push(`Dialogue: ${layer},${first.ass},${last.ass},${name},,0,0,0,,{\\pos(${position(t.x,t.y,t.scale,t.rotation)})\\fscx${t.scale*100}\\fscy${t.scale*100}\\frz${-t.rotation}}${text}`);
    }
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${canvas.width}\nPlayResY: ${canvas.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n${styles.join('\n')}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${events.join('\n')}\n`;
}
