(()=>{
 const trace={startedAt:new Date().toISOString(),events:[],gestures:[],errors:[]};let active=null,token='',revision=null,last='';
 const stamp=()=>Math.round(performance.now()*10)/10;const current=()=>{const stage=document.querySelector('.preview-stage');let metrics={};try{metrics=JSON.parse(stage?.dataset.previewMetrics||'{}');}catch{}return {time:stamp(),clock:document.querySelector('.player-time')?.textContent.trim(),state:stage?.dataset.previewState,frame:metrics.lastPresentedFrame,decodeWaitMs:metrics.lastDecodeWaitMs,scrubbing:document.querySelector('.timeline-scroll')?.dataset.scrubbing,metrics};};
 const note=(kind,extra={})=>{if(trace.events.length<5000)trace.events.push({kind,...current(),...extra});};
 const store=()=>{note('settled');fetch('/__qa/result',{method:'POST',headers:{'content-type':'application/json','x-editor-token':token},body:JSON.stringify(trace)}).catch(()=>{});};
 fetch('/api/bootstrap').then(r=>r.json()).then(b=>{token=b.token;trace.version=b.version;trace.engine=b.engine;});
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('.time-ruler,.playhead-handle')&&!(e.target.matches('.track-row')))return;active={id:trace.gestures.length,start:stamp(),x:e.clientX,y:e.clientY,frames:[],pointers:[]};trace.gestures.push(active);note('down',{x:e.clientX,y:e.clientY,pointer:e.pointerId});},true);
 document.addEventListener('pointermove',e=>{if(!active)return;active.pointers.push({at:stamp(),x:e.clientX,y:e.clientY});note('move',{x:e.clientX,y:e.clientY});},true);
 document.addEventListener('pointerup',e=>{if(!active)return;active.end=stamp();active.endX=e.clientX;active.endY=e.clientY;note('up',{x:e.clientX,y:e.clientY});active=null;setTimeout(store,1400);},true);
 document.addEventListener('pointercancel',()=>{note('cancel');active=null;setTimeout(store,1400);},true);
 new MutationObserver(()=>{const value=current(),key=JSON.stringify([value.clock,value.state,value.frame,value.scrubbing]);if(key===last)return;last=key;note('state');if(active&&value.state==='ready')active.frames.push({at:value.time,frame:value.frame});}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-preview-state','data-preview-metrics','data-scrubbing'],childList:true,characterData:true});
 window.addEventListener('error',e=>{trace.errors.push(String(e.message));});window.addEventListener('unhandledrejection',e=>trace.errors.push(String(e.reason)));
 const panel=document.createElement('div');panel.id='scrub-qa';panel.style='position:fixed;right:8px;bottom:4px;z-index:10000;background:#123;color:#cfc;font:12px monospace;padding:3px;pointer-events:none';panel.textContent='定位交互验证：原界面与媒体路径';document.body.append(panel);
})();
