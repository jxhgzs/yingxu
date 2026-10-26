/** One active decode and one replaceable destination. Pointer input never
 * restarts the active decode or creates a backlog of intermediate frames. */
export class LatestSeek<T,R> {
 private pending?:{value:T;generation:number};private running=false;private generation=0;private disposed=false;
 private seek:(value:T)=>Promise<R>;private publish:(result:R)=>void;private report:(error:unknown)=>void;
 constructor(seek:(value:T)=>Promise<R>,publish:(result:R)=>void,report:(error:unknown)=>void){this.seek=seek;this.publish=publish;this.report=report;}
 request(value:T){if(this.disposed)return;this.pending={value,generation:this.generation};this.start();}
 reset(){this.generation++;this.pending=undefined;}
 dispose(){this.reset();this.disposed=true;}
 private start(){if(!this.running&&!this.disposed&&this.pending){this.running=true;void this.drain();}}
 private async drain(){
  try{while(this.pending&&!this.disposed){const next=this.pending;this.pending=undefined;
   try{const result=await this.seek(next.value);if(!this.disposed&&next.generation===this.generation)this.publish(result);}
   catch(error){if(!this.disposed&&next.generation===this.generation)this.report(error);}
  }}finally{this.running=false;this.start();}
 }
}
