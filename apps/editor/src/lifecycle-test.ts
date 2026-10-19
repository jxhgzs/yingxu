import {mountEditor} from './host.ts';
import {emptyDocument} from '../../../packages/core/src/document.ts';
import type {Asset,Document} from '../../../packages/core/src/document.ts';
import {rational} from '../../../packages/core/src/time.ts';
import {GpuPreview} from './preview/index.ts';
const button=document.querySelector<HTMLButtonElement>('#run')!,output=document.querySelector<HTMLPreElement>('#result')!,host=document.querySelector<HTMLElement>('#host')!;
button.addEventListener('click',async()=>{
  button.disabled=true;let requests=0,lateChanges=0,cycles=0,disposeRejected=0;
  const original=window.fetch;window.fetch=(...args)=>{requests++;return original(...args);};
  try{
    for(let i=0;i<20;i++){
      let disposed=false,changes=0;
      const editor=mountEditor(host,{onChange:()=>{changes++;if(disposed)lateChanges++;}});
      await editor.ready;if(!changes)throw Error('INITIALIZATION_FAILED');
      editor.dispose();disposed=true;
      if(host.childElementCount!==0||host.querySelector('video'))throw Error('DOM_NOT_RELEASED');
      try{await editor.open(emptyDocument());}catch(e){if((e as Error).message==='EDITOR_DISPOSED')disposeRejected++;else throw e;}
      cycles++;output.textContent=`已完成 ${cycles} / 20`;
    }
    const atDispose=requests;await new Promise(resolve=>setTimeout(resolve,1000));
    const result={cycles,domChildren:host.childElementCount,lateChanges,requestsAfterDispose:requests-atDispose,disposedOpenRejected:disposeRejected};
    if(lateChanges||result.requestsAfterDispose||disposeRejected!==20)throw Error(JSON.stringify(result));
    output.textContent='通过\n'+JSON.stringify(result,null,2);output.dataset.status='passed';
  }catch(e){output.textContent='失败\n'+String(e);output.dataset.status='failed';}
  finally{window.fetch=original;button.disabled=false;}
});

// A real WEBGL_lose_context exercise. This read-only QA page never saves an
// editor document, starts an export or changes the service's selected project.
const gpuButton=document.querySelector<HTMLButtonElement>('#run-gpu')!,gpuOutput=document.querySelector<HTMLPreElement>('#gpu-result')!,gpuCanvas=document.querySelector<HTMLCanvasElement>('#gpu-canvas')!;
gpuButton.addEventListener('click',async()=>{
 gpuButton.disabled=true;let preview:GpuPreview|undefined;
 const states:string[]=[],waitFor=async(predicate:()=>boolean)=>{const until=performance.now()+10000;while(!predicate()){if(performance.now()>until)throw Error('GPU_STATE_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,20));}};
 try{
  const bootstrap=await(await fetch('/api/bootstrap')).json(),asset:Asset=bootstrap.assets.find((a:Asset)=>a.kind==='video');if(!asset)throw Error('IMPORT_TEST_VIDEO_FIRST');
  const r=rational,doc:Document={...emptyDocument(),canvas:{width:1280,height:720},fps:r(30),assets:[asset],tracks:[{id:'qa-video',kind:'video',clips:[{id:'qa-clip',materialId:asset.id,source:{start:r(0),duration:r(1)},target:{start:r(0),duration:r(1)},speed:r(1),editableTiming:true}]}]};
  preview=new GpuPreview(gpuCanvas,{mediaUrl:a=>new URL(`/media/${a.id}`,location.href).href,onState:m=>states.push(m.state)});
  await preview.setDocument(doc,{time:.5});if(preview.manifest.state!=='ready')throw Error('GPU_INITIAL_NOT_READY');
  const before=await preview.diagnoseColor(),gl=gpuCanvas.getContext('webgl2')!,extension=gl.getExtension('WEBGL_lose_context');if(!extension)throw Error('GPU_LOSS_EXTENSION_UNAVAILABLE');
  extension.loseContext();await waitFor(()=>preview!.manifest.state==='context-lost');
  if(preview.manifest.support.supported)throw Error('GPU_LOST_REMAINS_SUPPORTED');
  await new Promise(resolve=>setTimeout(resolve,100));extension.restoreContext();await waitFor(()=>preview!.manifest.state==='ready');
  const after=await preview.diagnoseColor();if(JSON.stringify(before.passes[0].final)!==JSON.stringify(after.passes[0].final))throw Error('GPU_RESTORE_PIXEL_CHANGED');
  const result={states,renderer:preview.manifest.renderer,contextLosses:preview.manifest.metrics.contextLosses,restoredState:preview.manifest.state,restoredFrame:after.frame,autoPlayed:states.slice(states.indexOf('context-lost')).includes('playing'),before:before.passes[0].final,after:after.passes[0].final};
  if(result.autoPlayed||result.contextLosses!==1)throw Error('GPU_RESTORE_STATE_INVALID');
  gpuOutput.textContent='通过\n'+JSON.stringify(result,null,2);gpuOutput.dataset.status='passed';
 }catch(e){gpuOutput.textContent='失败\n'+String(e)+'\n'+JSON.stringify({states,manifest:preview?.manifest});gpuOutput.dataset.status='failed';}
 finally{preview?.dispose({releaseContext:true});gpuButton.disabled=false;}
});
