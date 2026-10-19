import type {PlannedVisual} from './plan.ts';
import {layerVertices,transitionWeights} from './plan.ts';
import type {DecodedMedia} from './decode.ts';
import {colorShader,colorUniforms,previewColorState,validatePixelPoints} from './color.ts';
import type {ColorGL,ColorReadback,PixelPoint,PixelRead} from './color.ts';

const vertex=`#version 300 es
layout(location=0) in vec2 a_position; layout(location=1) in vec2 a_uv; out vec2 v_uv;
void main(){gl_Position=vec4(a_position,0.0,1.0);v_uv=a_uv;}`;
const fragment=`#version 300 es
precision highp float;uniform sampler2D u_image;uniform float u_opacity;in vec2 v_uv;out vec4 color;
${colorShader}
void main(){vec4 sampleColor=texture(u_image,v_uv);float alpha=sampleColor.a*u_opacity;color=vec4(previewColorAdjustments(sampleColor.rgb)*alpha,alpha);}`;
const mixFragment=`#version 300 es
precision highp float;uniform sampler2D u_outgoing;uniform sampler2D u_incoming;uniform float u_progress;uniform bool u_dipToBlack;in vec2 v_uv;out vec4 color;
void main(){vec4 outgoing=texture(u_outgoing,v_uv);vec4 incoming=texture(u_incoming,v_uv);
 if(u_dipToBlack){float wOut=max(1.0-2.0*u_progress,0.0);float wIn=max(2.0*u_progress-1.0,0.0);color=outgoing*wOut+incoming*wIn+vec4(0.0,0.0,0.0,1.0-wOut-wIn);}
 else color=mix(outgoing,incoming,u_progress);}`;
const screenVertices=new Float32Array([-1,1,0,1,1,1,1,1,-1,-1,0,0,-1,-1,0,0,1,1,1,1,1,-1,1,0]);
type Framebuffer={texture:WebGLTexture;framebuffer:WebGLFramebuffer};
function compileProgram(gl:WebGL2RenderingContext,pixelSource:string):WebGLProgram{
 const shaders:WebGLShader[]=[],program=gl.createProgram();if(!program)throw Error('GPU_PROGRAM_ALLOCATION_FAILED');
 const compile=(type:number,source:string)=>{const shader=gl.createShader(type);if(!shader)throw Error('GPU_SHADER_ALLOCATION_FAILED');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('GPU_SHADER_COMPILE_FAILED: '+gl.getShaderInfoLog(shader));return shader;};
 try{gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,pixelSource));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('GPU_PROGRAM_LINK_FAILED: '+gl.getProgramInfoLog(program));return program;}
 catch(e){gl.deleteProgram(program);throw e;}finally{for(const s of shaders)gl.deleteShader(s);}
}
type TimerExtension={TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number};
export type GLInfo={renderer:string;vendor:string;softwareRenderer:boolean;maxTextureSize:number;timerAvailable:boolean};
type Texture={texture:WebGLTexture;width:number;height:number;uploaded:boolean};
export class WebGLCompositor {
 readonly canvas:HTMLCanvasElement;
 readonly gl:WebGL2RenderingContext;readonly info:GLInfo;lastGpuMs?:number;
 private program:WebGLProgram;private buffer:WebGLBuffer;private vao:WebGLVertexArrayObject;
 private opacity:WebGLUniformLocation;private textures=new Map<string,Texture>();private timer?:TimerExtension;private queries:WebGLQuery[]=[];private disposed=false;
 private mixProgram?:WebGLProgram;private mixProgress?:WebGLUniformLocation;private mixDip?:WebGLUniformLocation;private targets:Framebuffer[]=[];framebufferAllocations=0;
 private fxEnabled:WebGLUniformLocation;private fxParameters:WebGLUniformLocation;private fxOffset:WebGLUniformLocation;
 private capture?:{points:PixelPoint[];readback:ColorReadback};
 get colorState(){return previewColorState(this.gl as ColorGL);}
 get framebufferCount(){return this.targets.length;}
 get framebufferBytes(){return this.targets.length*this.canvas.width*this.canvas.height*4;}
 constructor(canvas:HTMLCanvasElement){
  this.canvas=canvas;
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
  if(!gl)throw Error('WEBGL2_UNAVAILABLE');this.gl=gl;
  const program=compileProgram(gl,fragment);
  this.program=program;const buffer=gl.createBuffer(),vao=gl.createVertexArray();if(!buffer||!vao){gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);throw Error('GPU_BUFFER_ALLOCATION_FAILED');}
  this.buffer=buffer;this.vao=vao;
  try{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  for(const [name,offset] of [['a_position',0],['a_uv',8]] as const){const location=gl.getAttribLocation(program,name);if(location<0)throw Error('GPU_ATTRIBUTE_MISSING');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,16,offset);}
  gl.useProgram(program);const opacity=gl.getUniformLocation(program,'u_opacity'),image=gl.getUniformLocation(program,'u_image'),fxEnabled=gl.getUniformLocation(program,'u_fxEnabled'),fxParameters=gl.getUniformLocation(program,'u_fxParameters'),fxOffset=gl.getUniformLocation(program,'u_fxBrightnessOffset');
  if(opacity===null||image===null||fxEnabled===null||fxParameters===null||fxOffset===null)throw Error('GPU_UNIFORM_MISSING');this.opacity=opacity;this.fxEnabled=fxEnabled;this.fxParameters=fxParameters;this.fxOffset=fxOffset;gl.uniform1i(image,0);
  gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  const colorGL=gl as ColorGL;if('drawingBufferColorSpace' in gl)colorGL.drawingBufferColorSpace='srgb';if('unpackColorSpace' in gl)colorGL.unpackColorSpace='srgb';gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL);
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=String(gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER)),vendor=String(gl.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:gl.VENDOR));
  this.timer=(gl.getExtension('EXT_disjoint_timer_query_webgl2')||undefined) as TimerExtension|undefined;
  this.info={renderer,vendor,softwareRenderer:/swiftshader|llvmpipe|software rasterizer/i.test(renderer),maxTextureSize:Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),timerAvailable:!!this.timer};
  }catch(e){gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);throw e;}
 }
 resize(width:number,height:number){if(this.canvas.width!==width||this.canvas.height!==height){this.releaseTargets();this.canvas.width=width;this.canvas.height=height;}this.gl.viewport(0,0,width,height);}
 private releaseTargets(){for(const target of this.targets){this.gl.deleteFramebuffer(target.framebuffer);this.gl.deleteTexture(target.texture);}this.targets=[];}
 private ensureTargets(){
  const gl=this.gl;if(!this.mixProgram){const program=compileProgram(gl,mixFragment);try{
    const out=gl.getUniformLocation(program,'u_outgoing'),incoming=gl.getUniformLocation(program,'u_incoming'),progress=gl.getUniformLocation(program,'u_progress'),dip=gl.getUniformLocation(program,'u_dipToBlack');
    if(out===null||incoming===null||progress===null||dip===null)throw Error('GPU_UNIFORM_MISSING');gl.useProgram(program);gl.uniform1i(out,0);gl.uniform1i(incoming,1);this.mixProgress=progress;this.mixDip=dip;this.mixProgram=program;
   }catch(e){gl.deleteProgram(program);throw e;}}
  if(this.targets.length)return;
  try{for(let i=0;i<2;i++){
    const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();if(!texture||!framebuffer){gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);throw Error('GPU_FRAMEBUFFER_ALLOCATION_FAILED');}
    this.targets.push({texture,framebuffer});gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,this.canvas.width,this.canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('GPU_FRAMEBUFFER_INCOMPLETE');this.framebufferAllocations++;
   }}catch(e){this.releaseTargets();throw e;}finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 }
 private texture(id:string,media:DecodedMedia):WebGLTexture{
  const gl=this.gl,pixels=media.pixels;if(!pixels)throw Error('GPU_MISSING_PIXELS');
  const w=pixels instanceof HTMLVideoElement?pixels.videoWidth:pixels.naturalWidth,h=pixels instanceof HTMLVideoElement?pixels.videoHeight:pixels.naturalHeight;
  if(!w||!h||w>this.info.maxTextureSize||h>this.info.maxTextureSize)throw Error('GPU_TEXTURE_SIZE_LIMIT');
  let record=this.textures.get(id);if(!record){const texture=gl.createTexture();if(!texture)throw Error('GPU_TEXTURE_ALLOCATION_FAILED');record={texture,width:w,height:h,uploaded:false};this.textures.set(id,record);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);}
  gl.bindTexture(gl.TEXTURE_2D,record.texture);
  if(media.asset.kind!=='image'||!record.uploaded){
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,pixels);record.uploaded=true;
   const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('GPU_TEXTURE_UPLOAD_FAILED: '+error);
  }return record.texture;
 }
 private drawLayer(layer:PlannedVisual,media:Map<string,DecodedMedia>,canvas:{width:number;height:number}):number{
  const gl=this.gl,source=media.get(layer.clip.id);if(!source||source.state!=='ready')throw Error('GPU_MEDIA_NOT_READY');
  gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);const previous=this.textures.get(layer.clip.id)?.uploaded;this.texture(layer.clip.id,source);
  const fx=colorUniforms(layer.clip.colorAdjustments);gl.uniform4iv(this.fxEnabled,fx.mask);gl.uniform4fv(this.fxParameters,fx.parameters);gl.uniform1f(this.fxOffset,fx.brightnessOffset);
  gl.bufferData(gl.ARRAY_BUFFER,layerVertices(layer.asset,layer.transform,canvas),gl.DYNAMIC_DRAW);gl.uniform1f(this.opacity,layer.transform.opacity);gl.drawArrays(gl.TRIANGLES,0,6);
  return source.asset.kind!=='image'||!previous?1:0;
 }
 draw(layers:PlannedVisual[],media:Map<string,DecodedMedia>,canvas:{width:number;height:number}):{drawCalls:number;textureUploads:number;framebufferPasses:number;transitionDraws:number}{
  if(this.disposed||this.gl.isContextLost())throw Error('GPU_CONTEXT_LOST');const gl=this.gl;
  this.pollTimers();const query=this.timer&&this.queries.length<4?gl.createQuery():null;if(query)gl.beginQuery(this.timer!.TIME_ELAPSED_EXT,query);
  let uploads=0,drawCalls=0,framebufferPasses=0,transitionDraws=0;
  try{gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.activeTexture(gl.TEXTURE0);
   for(const layer of layers){if(!layer.transition){uploads+=this.drawLayer(layer,media,canvas);drawCalls++;continue;}
    this.ensureTargets();
    // Each side first resolves its own transform/opacity over transparent pixels.
    // One linear premultiplied mix is then composited over the existing stack.
    const captured:{outgoing:PixelRead[];incoming:PixelRead[]}={outgoing:[],incoming:[]};
    const weights=transitionWeights(layer.transition.kind,layer.transition.progress);
    for(const [i,side] of [layer,layer.transition.incoming].entries()){
     gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[i].framebuffer);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
     if(weights[i]>0){uploads+=this.drawLayer(side,media,canvas);drawCalls++;}framebufferPasses++;
     if(this.capture)captured[i===0?'outgoing':'incoming']=this.readPixels(this.capture.points);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.useProgram(this.mixProgram!);
    for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,this.targets[i].texture);}
    gl.bufferData(gl.ARRAY_BUFFER,screenVertices,gl.DYNAMIC_DRAW);gl.uniform1f(this.mixProgress!,Math.max(0,Math.min(1,layer.transition.progress)));gl.uniform1i(this.mixDip!,layer.transition.kind==='dipToBlack'?1:0);gl.drawArrays(gl.TRIANGLES,0,6);drawCalls++;transitionDraws++;
    if(this.capture)this.capture.readback.transitions.push({id:layer.transition.id,progress:layer.transition.progress,...captured});
   }
  }finally{if(this.targets.length){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);}if(query){gl.endQuery(this.timer!.TIME_ELAPSED_EXT);this.queries.push(query);}}
  if(this.capture)this.capture.readback.final=this.readPixels(this.capture.points);
  return {drawCalls,textureUploads:uploads,framebufferPasses,transitionDraws};
 }
 private readPixels(points:PixelPoint[]):PixelRead[]{
  const gl=this.gl;return points.map(({x,y})=>{const data=new Uint8Array(4);gl.readPixels(x,this.canvas.height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('GPU_DIAGNOSTIC_READ_FAILED: '+error);return {x,y,rgba:[data[0],data[1],data[2],data[3]]};});
 }
 /** Bounded synchronous readback; does not enable preserveDrawingBuffer or alter production upload policy. */
 diagnose(layers:PlannedVisual[],media:Map<string,DecodedMedia>,canvas:{width:number;height:number},points:PixelPoint[],mode:'browser-default'|'none'='browser-default'):ColorReadback{
  validatePixelPoints(points,this.canvas.width,this.canvas.height);if(mode!=='browser-default'&&mode!=='none')throw Error('GPU_DIAGNOSTIC_MODE_INVALID');
  const gl=this.gl,previous=gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) as number;gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,mode==='none'?gl.NONE:gl.BROWSER_DEFAULT_WEBGL);
  for(const texture of this.textures.values())texture.uploaded=false;
  const readback:ColorReadback={mode,state:this.colorState,width:this.canvas.width,height:this.canvas.height,final:[],transitions:[]};this.capture={points,readback};
  try{this.draw(layers,media,canvas);return readback;}
  finally{this.capture=undefined;gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,previous);for(const texture of this.textures.values())texture.uploaded=false;}
 }
 private pollTimers(){if(!this.timer)return;const gl=this.gl,disjoint=gl.getParameter(this.timer.GPU_DISJOINT_EXT);this.queries=this.queries.filter(q=>{if(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))return true;if(!disjoint)this.lastGpuMs=Number(gl.getQueryParameter(q,gl.QUERY_RESULT))/1e6;gl.deleteQuery(q);return false;});}
 release(id:string){const record=this.textures.get(id);if(record)this.gl.deleteTexture(record.texture);this.textures.delete(id);}
 /** Context loss already invalidated GL objects. Deleting them after restore
  * raises INVALID_OPERATION in real WebGL and poisons the next upload check. */
 abandon(){this.disposed=true;this.targets=[];this.textures.clear();this.queries=[];this.capture=undefined;}
 dispose(releaseContext=false){if(this.disposed)return;this.disposed=true;this.releaseTargets();for(const id of this.textures.keys())this.release(id);for(const q of this.queries)this.gl.deleteQuery(q);this.queries=[];this.gl.deleteBuffer(this.buffer);this.gl.deleteVertexArray(this.vao);this.gl.deleteProgram(this.program);if(this.mixProgram)this.gl.deleteProgram(this.mixProgram);if(releaseContext)this.gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
