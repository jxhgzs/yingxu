import {mountEditor} from './host.ts';
import {emptyDocument} from '../../../packages/core/src/document.ts';
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
