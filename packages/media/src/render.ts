import fs from 'node:fs/promises';
import path from 'node:path';
import {renderGraph} from './graph.ts';
import {ffmpeg, probe} from './probe.ts';
import {runProcess} from './process.ts';
import type {Document} from '../../core/src/document.ts';
import {toNumber, add} from '../../core/src/time.ts';
import {animationExpression,animatedValue,maxAnimatedValue,fraction} from './animation.ts';
import {resolveExportSettings} from '../../core/src/export.ts';
import type {ExportSettings} from '../../core/src/export.ts';
import {frameEdge,groupTextLayers,captionScript} from './captions.ts';
import {curveSourceExpression,curveTargetExpression,curveMediaRange} from './curve-speed.ts';
import {renderCurveAudio} from './curve-audio.ts';
import {prepareFonts} from './fonts.ts';

const seconds = (v: number) => v.toFixed(9);
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
function tempo(speed: number): string {
  const parts: number[] = []; let v = speed;
  while (v > 2) {parts.push(2); v /= 2;}
  while (v < 0.5) {parts.push(0.5); v /= 0.5;}
  parts.push(v); return parts.map(n => `atempo=${n}`).join(',');
}
export async function render(doc: Document, directory: string, options: {
  preview?: boolean; exportSettings?:ExportSettings; signal?: AbortSignal; onProgress?: (progress: number) => void
} = {}) {
  let reportedProgress=0;
  const report=(value:number)=>{if(!Number.isFinite(value))return;reportedProgress=Math.max(reportedProgress,Math.min(1,Math.max(0,value)));options.onProgress?.(reportedProgress);};
  const previewScale=Math.min(1,640/Math.max(doc.canvas.width,doc.canvas.height));
  const outputSettings=resolveExportSettings(doc,options.preview?{format:'mp4',size:{width:even(doc.canvas.width*previewScale),height:even(doc.canvas.height*previewScale)}}:options.exportSettings);
  doc={...doc,fps:outputSettings.fps};
  const graph = renderGraph(doc);
  directory = path.resolve(directory);
  await fs.mkdir(directory, {recursive: true});
  const {width,height}=outputSettings,scale=width/doc.canvas.width,yScale=height/doc.canvas.height;
  const fps = `${doc.fps.numerator}/${doc.fps.denominator}`;
  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-threads', '2', '-filter_complex_threads', '1'];
  const inputIndexes = new Map<string, number>();
  const layers=outputSettings.audioOnly?[]:graph.layers,audio=outputSettings.hasAudio?graph.audio:[];
  const bundledFonts=await prepareFonts(layers.flatMap(({clip})=>clip.text?[clip.text.font]:[]),directory);
  const curvedAudio=audio.filter(({clip})=>clip.speedCurve),preparedAudio=new Map<string,number>();
  const preparationShare=curvedAudio.length?.15:0;
  for (const {asset} of [...layers, ...audio.filter(({clip})=>!clip.speedCurve)]) if (asset.kind !== 'text' && !inputIndexes.has(asset.id)) {
    inputIndexes.set(asset.id, inputIndexes.size);
    if (asset.kind === 'image') args.push('-loop', '1', '-framerate', fps);
    args.push('-i', asset.path);
  }
  for(const [i,{asset,clip}] of curvedAudio.entries()){
    const prepared=await renderCurveAudio(asset,clip,directory,{sampleRate:outputSettings.audioSampleRate,signal:options.signal,
      onProgress:progress=>report(preparationShare*(i+progress)/curvedAudio.length)});
    preparedAudio.set(clip.id,inputIndexes.size+preparedAudio.size);
    args.push('-i',prepared.path);
  }
  const filters: string[] = outputSettings.audioOnly?[]:[`color=c=black:s=${width}x${height}:r=${fps}:d=${seconds(graph.duration)},format=rgba[base]`];
  let composite = 'base', index = 0;
  for (const layer of groupTextLayers(layers)) {
    const i=index++,next=`composite${i}`;
    if(Array.isArray(layer)){
      const file=`captions-${i}.ass`,content=captionScript(layer,doc.canvas,doc.fps);
      if(!content)continue;
      await fs.writeFile(path.join(directory,file),content);
      filters.push(`[${composite}]subtitles=filename=${file}${bundledFonts?':fontsdir=fonts':''}[${next}]`);
    }else{
      const {clip,asset}=layer,t=clip.transform!;
      const first=frameEdge(clip.target.start,doc.fps),last=frameEdge(add(clip.target.start,clip.target.duration),doc.fps);
      if(first.frame===last.frame)continue;
      const media = inputIndexes.get(asset.id)!;
      const fit = Math.min(width / (asset.width || width), height / (asset.height || height));
      const maxScale=maxAnimatedValue(clip,'scale',t.scale);
      const w = even((asset.width || width) * fit * maxScale), h = even((asset.height || height) * fit * maxScale);
      if (w > 16384 || h > 16384) throw Error('RENDER_TRANSFORM_LIMIT');
      const sourceClock=clip.speedCurve?`(${fraction(clip.source.start)}+${curveSourceExpression(clip,'t')})`:`(${fraction(clip.source.start)}+t*${fraction(clip.speed)})`;
      const globalClock=clip.speedCurve?`(${fraction(clip.source.start)}+${curveSourceExpression(clip,`(t-${fraction(clip.target.start)})`)})`:`(${fraction(clip.source.start)}+(t-${fraction(clip.target.start)})*${fraction(clip.speed)})`;
      const animatedScale=clip.animations?.some(a=>a.property==='scale');
      const scaleExpression=animationExpression(clip,'scale',clip.speedCurve?'ld(0)':sourceClock,t.scale);
      const scaleClock=clip.speedCurve?`st(0,${sourceClock});`:'';
      // The native clock is rounded to microseconds. Move each inverse boundary
      // back half a microsecond before upward FPS selection, on a nanosecond TB.
      // This preserves all 59 observed CFR frame choices, including rounded edges.
      const curveRange=clip.speedCurve?curveMediaRange(asset,clip,doc.fps):undefined;
      const trim=curveRange?`trim=start=${seconds(toNumber(curveRange.start))}:end=${seconds(toNumber(curveRange.end))}`:`trim=start=${seconds(asset.kind==='image'?0:toNumber(clip.source.start))}:duration=${seconds(toNumber(clip.source.duration))}`;
      const video = [trim,
        ...(clip.speedCurve?['settb=1/1000000000',`setpts='floor(((${curveTargetExpression(clip,`(PTS*TB-${fraction(curveRange!.origin)})`)})-0.0000005)/TB+0.5)'`]:[`setpts=(PTS-STARTPTS)/${toNumber(clip.speed)}`]), `fps=${fps}${clip.speedCurve?':round=up':''}`, animatedScale?`scale=w='${scaleClock}max(2,round(${(asset.width||width)*fit}*${scaleExpression}/2)*2)':h='${scaleClock}max(2,round(${(asset.height||height)*fit}*${scaleExpression}/2)*2)':eval=frame`:`scale=${w}:${h}`, 'setsar=1', 'format=rgba'];
      if (t.flipX) video.push('hflip'); if (t.flipY) video.push('vflip');
      if(clip.animations?.some(a=>a.property==='rotation')||animatedScale&&t.rotation){
        const box=even(Math.ceil(Math.hypot(w,h))+4);
        if(box>16384)throw Error('RENDER_TRANSFORM_LIMIT');
        const rotation=animationExpression(clip,'rotation',clip.speedCurve?'ld(0)':sourceClock,t.rotation);
        const angle=`${clip.speedCurve?`st(0,${sourceClock});`:''}(${rotation})*PI/180`;
        video.push(`pad=${box}:${box}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame`,`rotate=angle='${angle}':ow=iw:oh=ih:c=none`);
      }else if (t.rotation) video.push(`rotate=${t.rotation}*PI/180:ow=rotw(${t.rotation}*PI/180):oh=roth(${t.rotation}*PI/180):c=none`);
      if(clip.animations?.some(a=>a.property==='opacity')){
        const clock=sourceClock.replace(/\bt\b/g,'T'),alpha=animationExpression(clip,'opacity',clip.speedCurve?'ld(0)':clock,t.opacity);
        video.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${clip.speedCurve?`st(0,${clock});`:''}alpha(X,Y)*${alpha}'`,'format=rgba');
      }
      else video.push(`colorchannelmixer=aa=${t.opacity}`);
      video.push(`setpts=PTS+(${clip.target.start.numerator}/${clip.target.start.denominator})/TB`);
      filters.push(`[${media}:v]${video.join(',')}[visual${i}]`);
      const position=(key:'x'|'y',dimension:string,factor:number)=>`${clip.speedCurve&&clip.animations?.some(a=>a.property===key)?`st(0,${globalClock});`:''}(${dimension})/2+(${animationExpression(clip,key,clip.speedCurve?'ld(0)':globalClock,t[key])})*${factor}`;
      filters.push(`[${composite}][visual${i}]overlay=x='${position('x','W-w',scale)}':y='${position('y','H-h',yScale)}':eof_action=pass:repeatlast=0:enable='gte(n,${first.frame})*lt(n,${last.frame})'[${next}]`);
    }
    composite = next;
  }
  if(!outputSettings.audioOnly){
    filters.push(`[${composite}]trim=start_frame=${outputSettings.startFrame}:end_frame=${outputSettings.endFrame},setpts=PTS-STARTPTS,format=yuv420p[outv]`);
    if(outputSettings.format==='gif')filters.push('[outv]split[palette-input][gif-input]','[palette-input]palettegen[palette]','[gif-input][palette]paletteuse=dither=sierra2_4a[outgif]');
  }
  if(outputSettings.hasAudio){
  const sampleRate=outputSettings.audioSampleRate;
  filters.push(`anullsrc=r=${sampleRate}:cl=stereo,atrim=duration=${seconds(graph.duration)}[silence]`);
  const audios = ['silence'];
  for (const {asset, clip} of audio) {
    const name = `audio${audios.length}`; audios.push(name);
    const clock=clip.speedCurve?`(${fraction(clip.source.start)}+${curveSourceExpression(clip,'t')})`:`(${fraction(clip.source.start)}+t*${fraction(clip.speed)})`;
    const volume=animationExpression(clip,'volume',clip.speedCurve?'ld(0)':clock,clip.volume??1);
    const initial=animatedValue(clip,'volume',clip.target.start,clip.volume??1);
    const input=clip.speedCurve?preparedAudio.get(clip.id):inputIndexes.get(asset.id);
    const timing=clip.speedCurve?'asetpts=PTS-STARTPTS':`atrim=start=${seconds(toNumber(clip.source.start))}:duration=${seconds(toNumber(clip.source.duration))},asetpts=PTS-STARTPTS,aresample=${sampleRate},${tempo(toNumber(clip.speed))}`;
    const tail=clip.speedCurve?'':`,apad,atrim=duration=${seconds(toNumber(clip.target.duration))}`;
    filters.push(`[${input}:a]${timing},volume='${clip.speedCurve?`st(0,${clock});`:''}if(isnan(t),${initial},${volume})':eval=frame${tail},adelay=delays=${Math.round(toNumber(clip.target.start) * sampleRate)}S:all=1[${name}]`);
  }
  filters.push(audios.map(n => `[${n}]`).join('') + `amix=inputs=${audios.length}:normalize=0:duration=first,atrim=start=${seconds(toNumber(outputSettings.actualStart))}:duration=${seconds(outputSettings.duration)},asetpts=PTS-STARTPTS[outa]`);
  }
  const script = path.join(directory, 'filter.txt'); await fs.writeFile(script, filters.join(';\n'));
  await fs.writeFile(path.join(directory, 'graph.json'), JSON.stringify(graph, null, 2));
  await fs.writeFile(path.join(directory,'export-settings.json'),JSON.stringify(outputSettings,null,2));
  const partial = path.join(directory, `render.partial.${outputSettings.extension}`), output = path.join(directory, `render.${outputSettings.extension}`);
  args.push('-filter_complex_script', script);
  if(!outputSettings.audioOnly){
    args.push('-map',outputSettings.format==='gif'?'[outgif]':'[outv]');
    if(outputSettings.format==='gif')args.push('-loop','0','-final_delay',String(100/toNumber(outputSettings.fps)));
    else{
      args.push('-c:v',outputSettings.videoCodec==='hevc'?'libx265':'libx264','-preset','veryfast');
      if(outputSettings.videoCodec==='hevc')args.push('-x265-params','pools=2:frame-threads=2:log-level=error','-tag:v','hvc1');
      if(outputSettings.videoBitrateKbps)args.push('-b:v',outputSettings.videoBitrateKbps+'k');else args.push('-crf',options.preview?'27':'18');
      args.push('-pix_fmt','yuv420p','-r',fps);
    }
    args.push('-frames:v',String(outputSettings.frameCount));
  }
  if(outputSettings.hasAudio){
    args.push('-map','[outa]','-c:a',outputSettings.format==='mp3'?'libmp3lame':outputSettings.format==='wav'?'pcm_s16le':'aac','-ar',String(outputSettings.audioSampleRate));
    if(outputSettings.format!=='wav')args.push('-b:a',outputSettings.audioBitrateKbps+'k');
  }
  if(['mp4','mov','m4a'].includes(outputSettings.format))args.push('-movflags','+faststart');
  args.push('-t',seconds(outputSettings.duration),'-progress','pipe:1','-nostats',partial);
  await runProcess(ffmpeg(), args, {signal: options.signal, timeout: 30 * 60 * 1000, cwd: directory,
    onLine: line => {if (line.startsWith('out_time_us=')) report(Math.min(0.99, preparationShare+(1-preparationShare)*Number(line.slice(12)) / (outputSettings.duration * 1e6)));}});
  if (options.signal?.aborted) throw Error('JOB_CANCELLED');
  const info = await probe(partial), video = info.streams.find((s: any) => s.codec_type === 'video');
  if (!outputSettings.audioOnly&&(!video || video.width !== width || video.height !== height || Number(video.nb_frames) !== outputSettings.frameCount)) throw Error('EXPORT_VERIFICATION_FAILED');
  const sound=info.streams.find((s:any)=>s.codec_type==='audio');
  if(outputSettings.hasAudio&&(!sound||Number(sound.sample_rate)!==outputSettings.audioSampleRate))throw Error('EXPORT_AUDIO_VERIFICATION_FAILED');
  const actualDuration=Number(info.format.duration);
  if(!Number.isFinite(actualDuration)||Math.abs(actualDuration-outputSettings.duration)>(outputSettings.format==='gif'?.001:.15))throw Error('EXPORT_DURATION_VERIFICATION_FAILED');
  await fs.rename(partial, output); report(1);
  return {path: output, width:outputSettings.audioOnly?0:width,height:outputSettings.audioOnly?0:height, frameCount:outputSettings.audioOnly?0:outputSettings.frameCount,
    duration:actualDuration,format:outputSettings.format,extension:outputSettings.extension,mime:outputSettings.mime,info};
}
