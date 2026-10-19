import type {TextContext} from './text-cache.ts';
export type TextPreparation={projectId:string;revision:number;status:'ready'|'partial';requested:number;completed:number;uniqueTextures:number;bytes:number;elapsedMs:number;reason?:'cache-budget'};
export type TextPrepareProvider=(context:TextContext,frames:readonly {clipId:string;frame:number}[],signal:AbortSignal)=>Promise<TextPreparation>;
export type TextPreparationState=Omit<TextPreparation,'projectId'|'revision'|'status'>&{status:'idle'|'preparing'|'ready'|'partial'|'cancelled'|'error'};
export function validateTextPreparation(result:TextPreparation,context:TextContext,requested:number){
 if(!result||result.projectId!==context.projectId||result.revision!==context.revision||!['ready','partial'].includes(result.status)||result.requested!==requested||!Number.isSafeInteger(result.completed)||result.completed<0||result.completed>requested||(result.status==='ready'&&result.completed!==requested)||!Number.isSafeInteger(result.uniqueTextures)||result.uniqueTextures<0||result.uniqueTextures>result.completed||!Number.isSafeInteger(result.bytes)||result.bytes<0||result.bytes>256*1024*1024||!Number.isFinite(result.elapsedMs)||result.elapsedMs<0||(result.status==='partial'&&result.reason!=='cache-budget'))throw Error('GPU_TEXT_PREPARATION_INVALID');
}

export function withPreparationSignal<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;if(signal.aborted){void promise.catch(()=>{});return Promise.reject(new DOMException('Aborted','AbortError'));}
 return new Promise((resolve,reject)=>{const cleanup=()=>signal.removeEventListener('abort',cancel),cancel=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};signal.addEventListener('abort',cancel,{once:true});promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});
}
