import {spawn} from 'node:child_process';
import {recoverTextFrameStream} from './text-raster-stream.ts';
/** Own both subprocesses as one cancellable pipeline; no raw window is persisted or buffered. */
export async function renderTextFramePipeline(binary:string,renderArgs:string[],encodeArgs:string[],options:{cwd:string;frameBytes:number;frames:number;signal?:AbortSignal;timeout?:number}){
 if(options.signal?.aborted)throw Error('JOB_CANCELLED');
 const controller=new AbortController(),children:ReturnType<typeof spawn>[]=[],errors:string[]=[];let cancelled=false,timedOut=false,firstError:unknown;
 const terminate=()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
 const cancel=()=>{cancelled=true;controller.abort();terminate();};options.signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();terminate();},options.timeout??60000);let killTimer:ReturnType<typeof setTimeout>|undefined;
 const escalate=()=>{if(!killTimer)killTimer=setTimeout(()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},2000);};controller.signal.addEventListener('abort',escalate,{once:true});
 const launch=(args:string[],encode:boolean)=>{
  const child=spawn(binary,args,{cwd:options.cwd,stdio:encode?['pipe','ignore','pipe']:['ignore','pipe','pipe']});children.push(child);let stderr='';child.stderr!.setEncoding('utf8');child.stderr!.on('data',(s:string)=>{stderr=(stderr+s).slice(-32000);});
  const done=new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{errors.push(stderr);code===0?resolve():reject(Error(`MEDIA_PROCESS_FAILED (${code}): ${stderr.slice(-6000)}`));});});
  void done.catch(error=>{firstError??=error;controller.abort();terminate();});return {child,done};
 };
 let completion:Promise<unknown>[]=[];
 try{const encoder=launch(encodeArgs,true),renderer=launch(renderArgs,false);completion=[encoder.done,renderer.done];
  const transfer=recoverTextFrameStream(renderer.child.stdout!,encoder.child.stdin!,options.frameBytes,options.frames,controller.signal);completion.push(transfer);void transfer.catch(error=>{firstError??=error;controller.abort();terminate();});
  await Promise.all(completion);return {stderr:errors.join('')};
 }catch(error){controller.abort();terminate();await Promise.allSettled(completion);if(cancelled)throw Error('JOB_CANCELLED');if(timedOut)throw Error('MEDIA_PROCESS_TIMEOUT');throw firstError??error;
 }finally{clearTimeout(timer);clearTimeout(killTimer);options.signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',escalate);}
}
