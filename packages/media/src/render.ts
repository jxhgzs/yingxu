import fs from 'node:fs/promises';
import path from 'node:path';
import {renderGraph} from './graph.ts';
import {ffmpeg, probe} from './probe.ts';
import {runProcess} from './process.ts';
import type {Document,Clip} from '../../core/src/document.ts';
import type {Layer} from './graph.ts';
import {detectCfr30} from './frame-timing.ts';
import {transitionWindow,transitionSourceAt,transitionBoundaryPolicy} from '../../core/src/transitions.ts';
import {toNumber, add,sub,mul,frameTime,compare,div,rational} from '../../core/src/time.ts';
import {animationExpression,animatedValue,maxAnimatedValue,fraction} from './animation.ts';
import {resolveExportSettings} from '../../core/src/export.ts';
import type {ExportSettings} from '../../core/src/export.ts';
import {frameEdge,groupTextLayers,captionScript} from './captions.ts';
import {curveSourceExpression,curveTargetExpression,curveMediaRange} from './curve-speed.ts';
import {renderCurveAudio} from './curve-audio.ts';
import {prepareFonts} from './fonts.ts';
import {prepareColorEffects} from './color-effects-fast.ts';
import {resolveVideoColorSpace,VIDEO_COLOR_SPACE_POLICY} from '../../core/src/color-space.ts';

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
  const checkedBoundaryAssets=new Set<string>();
  for(const transition of doc.transitions||[])if(transition.kind==='crossfade'){
    const outgoing=layers.find(l=>l.clip.id===transition.outgoingClipId),incoming=layers.find(l=>l.clip.id===transition.incomingClipId);if(!outgoing||!incoming)continue;
    if(transitionBoundaryPolicy(doc.fps,transition,outgoing.clip,incoming.clip,outgoing.asset,incoming.asset)==='clone-cfr30')for(const {asset}of [outgoing,incoming])if(!checkedBoundaryAssets.has(asset.id)){if(await detectCfr30(asset,{signal:options.signal})!=='cfr30')throw Error('TRANSITION_SOURCE_FRAME_TIMING_UNVERIFIED: '+asset.id);checkedBoundaryAssets.add(asset.id);}
  }
  const preparedColors=new Map<string,Awaited<ReturnType<typeof prepareColorEffects>>>();
  for(const {clip} of layers)if(!preparedColors.has(clip.id))preparedColors.set(clip.id,await prepareColorEffects(clip.colorAdjustments,directory));
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
  const buildVisual=(layer:Layer,i:string,cloneBoundary=false)=>{
    const {clip,asset}=layer,t=clip.transform!;
    const first=frameEdge(clip.target.start,doc.fps),last=frameEdge(add(clip.target.start,clip.target.duration),doc.fps);
    if(first.frame===last.frame)return;
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
    const paddingHead=cloneBoundary&&compare(clip.source.start,rational(0))<0?sub(rational(0),clip.source.start):rational(0),requestedEnd=add(clip.source.start,clip.source.duration),paddingTail=cloneBoundary&&compare(requestedEnd,asset.duration)>0?sub(requestedEnd,asset.duration):rational(0);
    const headFrames=mul(paddingHead,rational(30)),tailFrames=mul(paddingTail,rational(30));
    if(headFrames.denominator!=='1'||tailFrames.denominator!=='1')throw Error('TRANSITION_SOURCE_FRAME_ALIGNMENT_UNVERIFIED');
    const mediaSourceStart=add(clip.source.start,paddingHead),sourceFrames=mul(mediaSourceStart,asset.fps||doc.fps),sourceFrame=BigInt(sourceFrames.numerator)/BigInt(sourceFrames.denominator);
    const decodeStart=toNumber(div(rational(sourceFrame),asset.fps||doc.fps));
    const trim=curveRange?`trim=start=${seconds(toNumber(curveRange.start))}:end=${seconds(toNumber(curveRange.end))}`:asset.kind==='image'?`trim=duration=${seconds(toNumber(clip.source.duration))}`:`trim=start=${(Math.floor(decodeStart*1e9)/1e9).toFixed(9)}:end=${seconds(toNumber(add(requestedEnd,paddingHead)))}`;
    const colorEffect=preparedColors.get(clip.id)?.filter;
    const colorSpace=asset.kind==='image'?undefined:resolveVideoColorSpace({...asset,width:asset.width||doc.canvas.width,height:asset.height||doc.canvas.height});
    // Keep input/output transfer and primaries equal: effects operate on encoded
    // components. An 8-bit RGB intermediate amplifies near-white inverse curves.
    const matrixNames={bt709:'709',smpte170m:'170m',bt470bg:'470bg',gbr:'gbr'} as const;
    const decodeColor=colorSpace?colorEffect?[`zscale=matrixin=${matrixNames[colorSpace.matrix]}:rangein=${colorSpace.range==='tv'?'limited':'full'}:primariesin=${colorSpace.primaries}:transferin=${colorSpace.transfer}:matrix=gbr:range=full:primaries=${colorSpace.primaries}:transfer=${colorSpace.transfer}:dither=none`,'format=gbrapf32le']:[`setparams=colorspace=${colorSpace.matrix}:color_primaries=${colorSpace.primaries}:color_trc=${colorSpace.transfer}:range=${colorSpace.range}`,`scale=${colorSpace.matrix==='gbr'?'':`in_color_matrix=${colorSpace.matrix==='bt470bg'?'bt601':colorSpace.matrix}:`}in_range=${colorSpace.range}:out_range=pc:flags=accurate_rnd+full_chroma_int`,'format=rgba']:['format=rgba'];
    const video = [...(cloneBoundary&&(headFrames.numerator!=='0'||tailFrames.numerator!=='0')?[`tpad=start=${headFrames.numerator}:stop=${tailFrames.numerator}:start_mode=clone:stop_mode=clone`]:[]),trim,
      ...(clip.speedCurve?['settb=1/1000000000',`setpts='floor(((${curveTargetExpression(clip,`(PTS*TB-${fraction(curveRange!.origin)})`)})-0.0000005)/TB+0.5)'`]:asset.kind==='image'?['setpts=PTS-STARTPTS']:['settb=1/1000000000',`setpts='floor((((PTS*TB-${fraction(mediaSourceStart)})/${fraction(clip.speed)})-0.0000005)/TB+0.5)'`]), `fps=${fps}:round=up`, ...decodeColor, ...(colorEffect?[colorEffect]:[]), animatedScale?`scale=w='${scaleClock}max(2,round(${(asset.width||width)*fit}*${scaleExpression}/2)*2)':h='${scaleClock}max(2,round(${(asset.height||height)*fit}*${scaleExpression}/2)*2)':eval=frame`:`scale=${w}:${h}`, 'setsar=1', 'format=rgba'];
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
    return {first,last,position};
  };
  let composite = 'base', index = 0;
  for (const layer of groupTextLayers(layers)) {
    const i=index++,next=`composite${i}`;
    if(Array.isArray(layer)){
      const file=`captions-${i}.ass`,content=captionScript(layer,doc.canvas,doc.fps);
      if(!content)continue;
      await fs.writeFile(path.join(directory,file),content);
      filters.push(`[${composite}]subtitles=filename=${file}${bundledFonts?':fontsdir=fonts':''}[${next}]`);
    }else{
      const visual=buildVisual(layer,String(i));if(!visual)continue;
      const excluded=(doc.transitions||[]).filter(t=>t.outgoingClipId===layer.clip.id||t.incomingClipId===layer.clip.id).map(t=>{const outgoing=layers.find(l=>l.clip.id===t.outgoingClipId)!.clip,w=transitionWindow(t,outgoing);return {first:frameEdge(w.start,doc.fps).frame,last:frameEdge(add(w.start,w.duration),doc.fps).frame};});
      const enabled=`gte(n,${visual.first.frame})*lt(n,${visual.last.frame})`+excluded.map(w=>`*not(gte(n,${w.first})*lt(n,${w.last}))`).join('');
      filters.push(`[${composite}][visual${i}]overlay=format=rgb:x='${visual.position('x','W-w',scale)}':y='${visual.position('y','H-h',yScale)}':eof_action=pass:repeatlast=0:enable='${enabled}'[${next}]`);
    }
    composite = next;
    if(!Array.isArray(layer))for(const transition of (doc.transitions||[]).filter(t=>t.outgoingClipId===layer.clip.id)){
      const outgoing=layers.find(l=>l.clip.id===transition.outgoingClipId)!,incoming=layers.find(l=>l.clip.id===transition.incomingClipId)!;
      const window=transitionWindow(transition,outgoing.clip),first=frameEdge(window.start,doc.fps).frame,last=frameEdge(add(window.start,window.duration),doc.fps).frame;
      const actualStart=frameTime(first,doc.fps),actualDuration=frameTime(last-first,doc.fps),prefix=`transition${index++}`;
      for(const [side,original] of [['a',outgoing],['b',incoming]] as const){
        const key=prefix+side,actualEnd=add(actualStart,actualDuration),originalEnd=add(original.clip.target.start,original.clip.target.duration);
        const activeStart=transition.kind==='dipToBlack'&&compare(actualStart,original.clip.target.start)<0?original.clip.target.start:actualStart;
        const activeEnd=transition.kind==='dipToBlack'&&compare(actualEnd,originalEnd)>0?originalEnd:actualEnd;
        const activeDuration=sub(activeEnd,activeStart),clip:Clip={...original.clip,source:{start:transitionSourceAt(original.clip,activeStart),duration:mul(activeDuration,original.clip.speed)},target:{start:sub(activeStart,actualStart),duration:activeDuration}};
        const cloneBoundary=transition.kind==='crossfade'&&transitionBoundaryPolicy(doc.fps,transition,outgoing.clip,incoming.clip,outgoing.asset,incoming.asset)==='clone-cfr30';
        const v=buildVisual({...original,clip},key,cloneBoundary);if(!v)throw Error('TRANSITION_DURATION_EMPTY');
        filters.push(`color=c=black@0:s=${width}x${height}:r=${fps}:d=${seconds(toNumber(actualDuration))},format=rgba[${key}base]`);
        filters.push(`[${key}base][visual${key}]overlay=format=rgb:x='${v.position('x','W-w',scale)}':y='${v.position('y','H-h',yScale)}':eof_action=pass:repeatlast=0,format=gbrap,premultiply=inplace=1[${key}premult]`);
      }
      const progress=`min(1,max(0,(T+${fraction(sub(actualStart,window.start))})/${fraction(window.duration)}))`;
      const mixed=prefix+'mixed',next=prefix+'out';
      const blend=transition.kind==='crossfade'?`blend=all_expr='A*(1-(${progress}))+B*(${progress})'`:`blend=c0_expr='A*max(1-2*(${progress}),0)+B*max(2*(${progress})-1,0)':c1_expr='A*max(1-2*(${progress}),0)+B*max(2*(${progress})-1,0)':c2_expr='A*max(1-2*(${progress}),0)+B*max(2*(${progress})-1,0)':c3_expr='A*max(1-2*(${progress}),0)+B*max(2*(${progress})-1,0)+255*(1-max(1-2*(${progress}),0)-max(2*(${progress})-1,0))'`;
      filters.push(`[${prefix}apremult][${prefix}bpremult]${blend},unpremultiply=inplace=1,format=rgba,setpts=PTS+(${fraction(actualStart)})/TB[${mixed}]`);
      filters.push(`[${composite}][${mixed}]overlay=format=rgb:eof_action=pass:repeatlast=0:enable='gte(n,${first})*lt(n,${last})'[${next}]`);
      composite=next;
    }
  }
  if(!outputSettings.audioOnly){
    filters.push(`[${composite}]trim=start_frame=${outputSettings.startFrame}:end_frame=${outputSettings.endFrame},setpts=PTS-STARTPTS,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[outv]`);
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
    const fade=clip.audioFade,fadeIn=fade?toNumber(fade.inDuration):0,fadeOut=fade?toNumber(fade.outDuration):0;
    const fades=(fadeIn>0?`,afade=t=in:st=0:d=${seconds(fadeIn)}:curve=qsin`:'')+(fadeOut>0?`,afade=t=out:st=${seconds(toNumber(clip.target.duration)-fadeOut)}:d=${seconds(fadeOut)}:curve=qsin`:'');
    filters.push(`[${input}:a]${timing},volume='${clip.speedCurve?`st(0,${clock});`:''}if(isnan(t),${initial},${volume})':eval=frame${tail}${fades},adelay=delays=${Math.round(toNumber(clip.target.start) * sampleRate)}S:all=1[${name}]`);
  }
  filters.push(audios.map(n => `[${n}]`).join('') + `amix=inputs=${audios.length}:normalize=0:duration=first,atrim=start=${seconds(toNumber(outputSettings.actualStart))}:duration=${seconds(outputSettings.duration)},asetpts=PTS-STARTPTS[outa]`);
  }
  const script = path.join(directory, 'filter.txt'); await fs.writeFile(script, filters.join(';\n'));
  await fs.writeFile(path.join(directory,'color-effects.json'),JSON.stringify([...preparedColors].map(([clipId,value])=>({clipId,...value.metadata})),null,2));
  await fs.writeFile(path.join(directory, 'graph.json'), JSON.stringify(graph, null, 2));
  await fs.writeFile(path.join(directory,'color-space.json'),JSON.stringify({policy:VIDEO_COLOR_SPACE_POLICY,output:{matrix:'bt709',primaries:'bt709',transfer:'bt709',range:'tv'},inputs:[...new Map(layers.filter(l=>l.asset.kind!=='text'&&l.asset.kind!=='image').map(l=>[l.asset.id,{id:l.asset.id,...resolveVideoColorSpace({...l.asset,width:l.asset.width||doc.canvas.width,height:l.asset.height||doc.canvas.height})}])).values()]},null,2));
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
      args.push('-pix_fmt','yuv420p','-r',fps,'-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv');
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
