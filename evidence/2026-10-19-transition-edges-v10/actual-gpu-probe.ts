// QA only. No execution until the real user-facing button is clicked.
import {fullReference,chromaDiff} from './reference.ts';
import {GpuPreview,createPreviewPlan,previewFrame} from '/apps/editor/src/preview/index.ts';
import {DecodedMedia} from '/apps/editor/src/preview/decode.ts';
import {rational,div} from '/packages/core/src/time.ts';
const button=document.querySelector('#run') as HTMLButtonElement,output=document.querySelector('#output')!,canvas=document.querySelector('#canvas') as HTMLCanvasElement;
const W=1280,H=720,frameBytes=W*H*4;let boot:any,engine:GpuPreview|undefined,nativeDecoder:DecodedMedia|undefined;
const radii=new Float64Array(W*H),anchorRadii=new Float64Array(W*H);
// No GPU is allocated here. Geometry is prepared only after click as well.
function geometry(){for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;radii[i]=Math.hypot(x+.5-W/2,y+.5-H/2);anchorRadii[i]=Math.hypot((x&~1)+.5-W/2,(y&~1)+.5-H/2);}}
async function save(name:string,body:BodyInit){const response=await fetch('./'+name,{method:'POST',headers:{'x-editor-token':boot.token},body});if(!response.ok)throw Error('SAVE '+name+' '+response.status);}
const tick=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function read(gl:WebGL2RenderingContext,framebuffer:WebGLFramebuffer|null,width=W,height=H){gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);const raw=new Uint8Array(width*height*4),top=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);const err=gl.getError();if(err!==gl.NO_ERROR)throw Error('FULL_READ '+err);for(let y=0;y<height;y++)top.set(raw.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);return top;}
function capture(){
 const compositor=(engine as any).compositor,gl=compositor.gl as WebGL2RenderingContext;if(canvas.width!==W||canvas.height!==H||compositor.targets.length!==2)throw Error('ACTUAL_FBO_SIZE');
 const planeUniform=gl.getUniform(compositor.mixProgram,compositor.mixPlaneEdges),spatialUniform=gl.getUniform(compositor.mixProgram,compositor.mixSpatial),centeredUniform=gl.getUniform(compositor.mixProgram,compositor.mixCentered420);
 const final=read(gl,null),a=read(gl,compositor.targets[0].framebuffer),b=read(gl,compositor.targets[1].framebuffer);const uv=centeredUniform?read(gl,compositor.planeTarget.framebuffer,W/2,H/2):undefined;gl.bindFramebuffer(gl.FRAMEBUFFER,null);return {a,b,final,uv,centeredUniform:!!centeredUniform,planeUniform:!!planeUniform,spatialUniform};
}
/** Independent scalar equations, no imports from product transition-edge math.
 * Pixel centres are top-origin. UV mask centre is the upper-left pixel centre
 * of each 2x2 block. RGB coefficients are the BT709 contract, not native code. */
function reference(a:Uint8Array|Uint8ClampedArray,b:Uint8Array|Uint8ClampedArray,kind:string,p:number,plane:boolean){
 const expected=new Float32Array(frameBytes),radius=p*Math.hypot(W,H)/2,threshold=W*(1-p);let crossed=0,minAlpha=255;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const pixel=y*W+x,i=pixel*4,isA=kind==='wipeLeft'?x+.5<=threshold:radii[pixel]>=radius,anchorA=kind==='wipeLeft'?(x&~1)+.5<=threshold:anchorRadii[pixel]>=radius,selected=isA?a:b;
  minAlpha=Math.min(minAlpha,a[i+3],b[i+3]);expected[i]=selected[i];expected[i+1]=selected[i+1];expected[i+2]=selected[i+2];expected[i+3]=255;
  if(!plane||isA===anchorA)continue;crossed++;
  const ci=((y&~1)*W+(x&~1))*4,c=anchorA?a:b;
  const yy=(.2126*selected[i]+.7152*selected[i+1]+.0722*selected[i+2])/255,cy=(.2126*c[ci]+.7152*c[ci+1]+.0722*c[ci+2])/255;
  const u=(c[ci+2]/255-cy)/(2*(1-.0722)),v=(c[ci]/255-cy)/(2*(1-.2126)),r=yy+2*(1-.2126)*v,bl=yy+2*(1-.0722)*u,g=(yy-.2126*r-.0722*bl)/.7152;
  expected[i]=Math.max(0,Math.min(1,r))*255;expected[i+1]=Math.max(0,Math.min(1,g))*255;expected[i+2]=Math.max(0,Math.min(1,bl))*255;
 }
 return {expected,crossSidePixels:crossed,minSourceAlpha:minAlpha};
}
function diff(actual:Uint8Array|Uint8ClampedArray,expected:Uint8Array|Uint8ClampedArray|Float32Array){let sum=0,max=0,over1=0,over3=0,worst:any;
 for(let i=0;i<frameBytes;i++){if(i%4===3)continue;const d=Math.abs(actual[i]-expected[i]);sum+=d;if(d>1)over1++;if(d>3)over3++;if(d>max){max=d;const pixel=i>>>2,x=pixel%W,y=Math.floor(pixel/W);worst={x,y,channel:i%4,actual:actual[i],expected:expected[i],anchor:{x:x&~1,y:y&~1}};}}
 return {meanRGB:sum/(W*H*3),maxRGB:max,over1RGB:over1,over3RGB:over3,worst};
}
async function timer(){const c=(engine as any).compositor,gl=c.gl as WebGL2RenderingContext,ext=c.timer,q=c.queries.at(-1);if(!ext||!q)return{available:false,reason:'query unavailable'};for(let i=0;i<120;i++){if(gl.getParameter(ext.GPU_DISJOINT_EXT))return{available:false,reason:'GPU disjoint'};if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))return{available:true,gpuMs:Number(gl.getQueryParameter(q,gl.QUERY_RESULT))/1e6,scope:'same product draw timer query before next seek'};await tick();}return{available:false,reason:'bounded query wait expired'};}
function points(a:Uint8Array|Uint8ClampedArray){return [[597,201],[596,200],[1007,361],[1006,360],[640,360],[0,0]].map(([x,y])=>({x,y,rgba:[...a.subarray((y*W+x)*4,(y*W+x)*4+4)]}));}
button.onclick=async()=>{
 button.disabled=true;const startedAt=new Date().toISOString();let report:any;try{
  boot=await(await fetch('/api/bootstrap')).json();const data=await(await fetch('./cases.json')).json();geometry();const cases:any[]=[],states:any[]=[];
  engine=new GpuPreview(canvas,{maxDimension:1280,mediaUrl:asset=>location.origin+'/media/'+asset.id,onState:manifest=>states.push({state:manifest.state,frame:manifest.metrics.lastPresentedFrame})});
  const nativeCanvas=document.createElement('canvas');nativeCanvas.width=W;nativeCanvas.height=H;const ctx=nativeCanvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true})!;if(!ctx)throw Error('NATIVE_CANVAS');
  const nativeFrame=async(n:number)=>{await nativeDecoder!.seek(n/30+.0001);await tick();await tick();ctx.drawImage(nativeDecoder!.pixels!,0,0,W,H);const image=ctx.getImageData(0,0,W,H);return {pixels:image.data,meta:{currentTime:nativeDecoder!.media?.currentTime,decodedTime:nativeDecoder!.decodedTime,colorSpace:image.colorSpace,readyState:nativeDecoder!.media?.readyState}};};
  for(const c of data.cases){
   output.textContent='读取原生首尾端点：'+c.id;nativeDecoder=new DecodedMedia('native-'+c.id,c.native,location.origin+'/media/'+c.native.id);await nativeDecoder.ready;
   const endA=await nativeFrame(0),endB=await nativeFrame(119);await save('capture-'+c.id+'-native-end-a.rgba',endA.pixels);await save('capture-'+c.id+'-native-end-b.rgba',endB.pixels);
   await engine.setDocument(c.document,{time:0});if(!engine.manifest.support.supported)throw Error('GPU_FALLBACK '+JSON.stringify(engine.manifest));const plan=createPreviewPlan(c.document).plan!,rows=[];
   for(const n of c.frames){
    output.textContent=c.id+'：全图验证帧 '+n+' / 74（seek不计实时帧率）';const seekStart=performance.now();await engine.seek(div(rational(n),rational(30)));const seekWallMs=performance.now()-seekStart;if(engine.manifest.metrics.lastPresentedFrame!==n)throw Error('WRONG_FRAME '+JSON.stringify(engine.manifest));
    const pair=previewFrame(plan,div(rational(n),rational(30))).layers.find(l=>l.transition)!.transition!,actual=capture(),p=(n-45)/30;
    const newManifest=engine.manifest,drawMetrics=newManifest.metrics,newTimer=await timer();if(!actual.uv||!actual.centeredUniform||pair.edgeReconstruction!=='centered-bilinear444-v2')throw Error('V2_NOT_ACTIVE');
    const mathStart=performance.now(),math=fullReference(actual.a,actual.b,c.kind,p),fromUV=fullReference(actual.a,actual.b,c.kind,p,actual.uv),mathWallMs=performance.now()-mathStart;
    // Explicit QA v1 control on the identical real source/frame. No forged pixel
    // metadata and no persisted document change: only the generated private plan
    // reconstruction selector is temporarily removed, then restored in finally.
    const generated=(engine as any).plan.previewTransitions[0],savedMode=generated.edgeReconstruction;let control:any,controlTimer:any,controlMetrics:any;
    try{generated.edgeReconstruction=undefined;await engine.seek(div(rational(n),rational(30)));control=capture();controlTimer=await timer();controlMetrics=engine.manifest.metrics;}finally{generated.edgeReconstruction=savedMode;}
    const native=await nativeFrame(n);
    const row={frame:n,progress:p,reportedProgress:pair.progress,edgePolicy:pair.edgePolicy,edgeReconstruction:pair.edgeReconstruction,actualCenteredUniform:actual.centeredUniform,actualPlaneUniform:actual.planeUniform,actualSpatialUniform:actual.spatialUniform,actualFBO:{width:W,height:H},samplePoints:n===c.captureFrame?{a:points(actual.a),b:points(actual.b),final:points(actual.final)}:undefined,math:diff(actual.final,math.expected),minSourceAlpha:math.minSourceAlpha,chromaMath:chromaDiff(actual.uv,math.uv),finalFromActualChromaMath:diff(actual.final,fromUV.expected),actualNativeFrame:diff(actual.final,native.pixels),v1Control:{centeredUniform:control.centeredUniform,planeUniform:control.planeUniform,actualNativeFrame:diff(control.final,native.pixels),timer:controlTimer,drawCpuMs:controlMetrics.lastCpuMs,framebufferBytes:controlMetrics.framebufferBytes},timing:{newDraw:newTimer,drawCpuMs:drawMetrics.lastCpuMs,seekWallMs,qaReferenceWallMs:mathWallMs},nativeFrame:native.meta,manifest:newManifest};rows.push(row);
    if(n===c.captureFrame){for(const [name,value]of [['a',actual.a],['b',actual.b],['final',actual.final],['native',native.pixels],['chroma',actual.uv],['v1control',control.final]] as const)await save('capture-'+c.id+'-'+n+'-'+name+'.rgba',value);}
    await tick();
   }
   await engine.setDocument(c.unknownDocument,{time:61/30});const unknown=capture(),unknownPair=previewFrame(createPreviewPlan(c.unknownDocument).plan!,div(rational(61),rational(30))).layers.find(l=>l.transition)!.transition!,old=reference(unknown.a,unknown.b,c.kind,16/30,false);
   cases.push({id:c.id,source:c.source,native:c.native,nativeEndpoints:{a:endA.meta,b:endB.meta},rows,unknown:{pixelFormats:c.unknownDocument.assets.map((a:any)=>a.pixelFormat??null),edgePolicy:unknownPair.edgePolicy??null,actualPlaneUniform:unknown.planeUniform,actualSpatialUniform:unknown.spatialUniform,centeredUniform:unknown.centeredUniform,math:diff(unknown.final,old.expected)},captureFrame:c.captureFrame});nativeDecoder.dispose();nativeDecoder=undefined;
  }
  const beforeDispose=engine.manifest;engine.dispose({releaseContext:true});
  report={startedAt,completedAt:new Date().toISOString(),sourceHashes:boot.sourceHashes,cases,states,beforeDispose,afterDispose:engine.manifest,summary:{width:W,height:H,framesPerKind:30,fullRGBPixelsPerFrame:W*H,allPlaneUniformsTrue:cases.every(c=>c.rows.every((r:any)=>r.actualPlaneUniform&&r.edgePolicy==='bt709-cosited420-v1')),unknownUniformsFalse:cases.every(c=>!c.unknown.actualPlaneUniform&&!c.unknown.centeredUniform&&c.unknown.edgePolicy===null),allSourceOpaque:cases.every(c=>c.rows.every((r:any)=>r.minSourceAlpha===255)),allCenteredUniformsTrue:cases.every(c=>c.rows.every((r:any)=>r.actualCenteredUniform&&r.edgeReconstruction==='centered-bilinear444-v2')),allV1ControlsExplicit:cases.every(c=>c.rows.every((r:any)=>!r.v1Control.centeredUniform&&r.v1Control.planeUniform)),maxMathRGB:Math.max(...cases.flatMap(c=>c.rows.map((r:any)=>r.math.maxRGB))),scope:'Actual v2 and explicit v1 product WebGL2 on same source/frame; all pixels45..74. UV-surface quantization, final reconstruction and native browser MOV separately; per-draw CPU/GPU timer query recorded, seek/reference cost separate. Not a realtime fps benchmark, no native1:1 claim.'}};
  await save('result.json',JSON.stringify(report));output.textContent=JSON.stringify(report,null,2);
 }catch(error){report={startedAt,completedAt:new Date().toISOString(),error:String(error),stack:error instanceof Error?error.stack:undefined,manifest:engine?.manifest};output.textContent=JSON.stringify(report,null,2);if(boot)await save('result.json',JSON.stringify(report));}
 finally{nativeDecoder?.dispose();nativeDecoder=undefined;engine?.dispose({releaseContext:true});button.disabled=false;}
};
