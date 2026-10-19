import fs from 'node:fs/promises';
import path from 'node:path';
import {renderGraph} from './graph.ts';
import {ffmpeg, probe} from './probe.ts';
import {runProcess} from './process.ts';
import type {Document} from '../../core/src/document.ts';
import {toNumber, add, mul, div, rational} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';
import {animationExpression,animatedValue,maxAnimatedValue,fraction} from './animation.ts';

const seconds = (v: number) => v.toFixed(9);
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
function frameEdge(time: Rational, fps: Rational) {
  const f = mul(time,fps),n=BigInt(f.numerator),d=BigInt(f.denominator),frame=(n+d-1n)/d;
  const edge=div(rational(frame),fps);
  const cs=Number(BigInt(edge.numerator)*100n/BigInt(edge.denominator)),h=Math.floor(cs/360000),m=Math.floor(cs/6000)%60;
  return {frame:Number(frame),ass:`${h}:${String(m).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`};
}
function assText(text: string) {
  // Break literal backslash commands without changing the visible slash glyph; braces have native ASS escapes.
  return text.replace(/\\/g, '\\\u200b').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\N');
}
function tempo(speed: number): string {
  const parts: number[] = []; let v = speed;
  while (v > 2) {parts.push(2); v /= 2;}
  while (v < 0.5) {parts.push(0.5); v /= 0.5;}
  parts.push(v); return parts.map(n => `atempo=${n}`).join(',');
}
export async function render(doc: Document, directory: string, options: {
  preview?: boolean; signal?: AbortSignal; onProgress?: (progress: number) => void
} = {}) {
  const graph = renderGraph(doc);
  directory = path.resolve(directory);
  await fs.mkdir(directory, {recursive: true});
  const scale = options.preview ? Math.min(1, 640 / Math.max(doc.canvas.width, doc.canvas.height)) : 1;
  const width = even(doc.canvas.width * scale), height = even(doc.canvas.height * scale);
  const fps = `${doc.fps.numerator}/${doc.fps.denominator}`;
  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-threads', '2', '-filter_complex_threads', '1'];
  const inputIndexes = new Map<string, number>();
  for (const {asset} of [...graph.layers, ...graph.audio]) if (asset.kind !== 'text' && !inputIndexes.has(asset.id)) {
    inputIndexes.set(asset.id, inputIndexes.size);
    if (asset.kind === 'image') args.push('-loop', '1', '-framerate', fps);
    args.push('-i', asset.path);
  }
  const filters: string[] = [`color=c=black:s=${width}x${height}:r=${fps}:d=${seconds(graph.duration)},format=rgba[base]`];
  let composite = 'base', index = 0;
  for (const {clip, asset} of graph.layers) {
    const i = index++, next = `composite${i}`, t = clip.transform!;
    const start = toNumber(clip.target.start), length = toNumber(clip.target.duration);
    const first = frameEdge(clip.target.start,doc.fps), last=frameEdge(add(clip.target.start,clip.target.duration),doc.fps);
    if(first.frame===last.frame)continue;
    if (asset.kind === 'text') {
      const style = clip.text!, rgb = style.color.slice(1), color = `&H${Math.round((1 - t.opacity) * 255).toString(16).padStart(2, '0')}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
      const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${doc.canvas.width}\nPlayResY: ${doc.canvas.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,${style.font},${style.size},${color},&H000000FF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1,1,5,20,20,20,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,${first.ass},${last.ass},Default,,0,0,0,,{\\pos(${doc.canvas.width / 2 + t.x},${doc.canvas.height / 2 + t.y})\\fscx${t.scale * 100}\\fscy${t.scale * 100}\\frz${-t.rotation}}${assText(style.content)}\n`;
      let content=ass;
      if(clip.animations?.length){
        const header=ass.slice(0,ass.indexOf('Dialogue:')),events:string[]=[];
        for(let frame=first.frame;frame<last.frame;frame++){
          const time=div(rational(frame),doc.fps),edge=frameEdge(time,doc.fps),end=frameEdge(div(rational(frame+1),doc.fps),doc.fps);
          const value=(property:'x'|'y'|'scale'|'rotation'|'opacity')=>animatedValue(clip,property,time,t[property]);
          const alpha=Math.round((1-value('opacity'))*255).toString(16).padStart(2,'0');
          events.push(`Dialogue: 0,${edge.ass},${end.ass},Default,,0,0,0,,{\\pos(${doc.canvas.width/2+value('x')},${doc.canvas.height/2+value('y')})\\fscx${value('scale')*100}\\fscy${value('scale')*100}\\frz${-value('rotation')}\\alpha&H${alpha}&}${assText(style.content)}`);
        }
        content=header+events.join('\n')+'\n';
      }
      const file = `caption-${i}.ass`; await fs.writeFile(path.join(directory, file), content);
      filters.push(`[${composite}]subtitles=filename=${file}[${next}]`);
    } else {
      const media = inputIndexes.get(asset.id)!;
      const fit = Math.min(width / (asset.width || width), height / (asset.height || height));
      const maxScale=maxAnimatedValue(clip,'scale',t.scale);
      const w = even((asset.width || width) * fit * maxScale), h = even((asset.height || height) * fit * maxScale);
      if (w > 16384 || h > 16384) throw Error('RENDER_TRANSFORM_LIMIT');
      const sourceClock=`(${fraction(clip.source.start)}+t*${fraction(clip.speed)})`,globalClock=`(${fraction(clip.source.start)}+(t-${fraction(clip.target.start)})*${fraction(clip.speed)})`;
      const animatedScale=clip.animations?.some(a=>a.property==='scale');
      const scaleExpression=animationExpression(clip,'scale',sourceClock,t.scale);
      const video = [`trim=start=${seconds(asset.kind === 'image' ? 0 : toNumber(clip.source.start))}:duration=${seconds(toNumber(clip.source.duration))}`,
        `setpts=(PTS-STARTPTS)/${toNumber(clip.speed)}`, `fps=${fps}`, animatedScale?`scale=w='max(2,round(${(asset.width||width)*fit}*${scaleExpression}/2)*2)':h='max(2,round(${(asset.height||height)*fit}*${scaleExpression}/2)*2)':eval=frame`:`scale=${w}:${h}`, 'setsar=1', 'format=rgba'];
      if (t.flipX) video.push('hflip'); if (t.flipY) video.push('vflip');
      if(clip.animations?.some(a=>a.property==='rotation')||animatedScale&&t.rotation){
        const box=even(Math.ceil(Math.hypot(w,h))+4);
        if(box>16384)throw Error('RENDER_TRANSFORM_LIMIT');
        video.push(`pad=${box}:${box}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame`,`rotate=angle='${animationExpression(clip,'rotation',sourceClock,t.rotation)}*PI/180':ow=iw:oh=ih:c=none`);
      }else if (t.rotation) video.push(`rotate=${t.rotation}*PI/180:ow=rotw(${t.rotation}*PI/180):oh=roth(${t.rotation}*PI/180):c=none`);
      if(clip.animations?.some(a=>a.property==='opacity'))video.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${animationExpression(clip,'opacity',sourceClock.replace(/\bt\b/g,'T'),t.opacity)}'`,'format=rgba');
      else video.push(`colorchannelmixer=aa=${t.opacity}`);
      video.push(`setpts=PTS+(${clip.target.start.numerator}/${clip.target.start.denominator})/TB`);
      filters.push(`[${media}:v]${video.join(',')}[visual${i}]`);
      filters.push(`[${composite}][visual${i}]overlay=x='(W-w)/2+(${animationExpression(clip,'x',globalClock,t.x)})*${scale}':y='(H-h)/2+(${animationExpression(clip,'y',globalClock,t.y)})*${scale}':eof_action=pass:repeatlast=0:enable='gte(n,${first.frame})*lt(n,${last.frame})'[${next}]`);
    }
    composite = next;
  }
  filters.push(`[${composite}]format=yuv420p[outv]`);
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(graph.duration)}[silence]`);
  const audios = ['silence'];
  for (const {asset, clip} of graph.audio) {
    const name = `audio${audios.length}`; audios.push(name);
    const clock=`(${fraction(clip.source.start)}+t*${fraction(clip.speed)})`,volume=animationExpression(clip,'volume',clock,clip.volume??1);
    const initial=animatedValue(clip,'volume',clip.target.start,clip.volume??1);
    filters.push(`[${inputIndexes.get(asset.id)}:a]atrim=start=${seconds(toNumber(clip.source.start))}:duration=${seconds(toNumber(clip.source.duration))},asetpts=PTS-STARTPTS,aresample=48000,${tempo(toNumber(clip.speed))},volume='if(isnan(t),${initial},${volume})':eval=frame,apad,atrim=duration=${seconds(toNumber(clip.target.duration))},adelay=delays=${Math.round(toNumber(clip.target.start) * 48000)}S:all=1[${name}]`);
  }
  filters.push(audios.map(n => `[${n}]`).join('') + `amix=inputs=${audios.length}:normalize=0:duration=first[outa]`);
  const script = path.join(directory, 'filter.txt'); await fs.writeFile(script, filters.join(';\n'));
  await fs.writeFile(path.join(directory, 'graph.json'), JSON.stringify(graph, null, 2));
  const partial = path.join(directory, 'render.partial.mp4'), output = path.join(directory, 'render.mp4');
  args.push('-filter_complex_script', script, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', options.preview ? '27' : '18', '-r', fps, '-frames:v', String(graph.frameCount), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', seconds(graph.duration), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', partial);
  await runProcess(ffmpeg(), args, {signal: options.signal, timeout: 30 * 60 * 1000, cwd: directory,
    onLine: line => {if (line.startsWith('out_time_us=')) options.onProgress?.(Math.min(0.99, Number(line.slice(12)) / (graph.duration * 1e6)));}});
  if (options.signal?.aborted) throw Error('JOB_CANCELLED');
  const info = await probe(partial), video = info.streams.find((s: any) => s.codec_type === 'video');
  if (!video || video.width !== width || video.height !== height || Number(video.nb_frames) !== graph.frameCount) throw Error('EXPORT_VERIFICATION_FAILED');
  await fs.rename(partial, output); options.onProgress?.(1);
  return {path: output, width, height, frameCount: graph.frameCount, duration: graph.duration, info};
}
