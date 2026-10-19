import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {renderTextFramePipeline} from '../packages/media/src/text-raster-process.ts';
async function fixture(renderer:string,encoder:string){const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'text-stream-process-'));await fs.writeFile(path.join(cwd,'renderer.cjs'),`require('fs').writeFileSync('renderer.pid',String(process.pid));${renderer}`);await fs.writeFile(path.join(cwd,'encoder.cjs'),`require('fs').writeFileSync('encoder.pid',String(process.pid));${encoder}`);return cwd;}
async function exited(cwd:string){for(const name of ['renderer','encoder']){const pid=Number(await fs.readFile(path.join(cwd,name+'.pid'),'utf8').catch(()=>0));if(pid)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},name+' exited');}}
test('failed encoder terminates its waiting renderer and drains both subprocesses',{timeout:5000},async()=>{
 const cwd=await fixture("process.stdout.write(Buffer.alloc(16));setInterval(()=>{},1000);","setTimeout(()=>process.exit(7),60);");try{await assert.rejects(renderTextFramePipeline(process.execPath,['renderer.cjs'],['encoder.cjs'],{cwd,frameBytes:8,frames:1}),/MEDIA_PROCESS_FAILED \(7\)/);await exited(cwd);}finally{await fs.rm(cwd,{recursive:true,force:true});}
});
test('pipeline cancellation kills both owned subprocesses before rejecting and prevents late success',{timeout:5000},async()=>{
 const cwd=await fixture("process.stdout.write(Buffer.alloc(8));setInterval(()=>{},1000);","process.stdin.resume();setInterval(()=>{},1000);"),controller=new AbortController();try{const work=renderTextFramePipeline(process.execPath,['renderer.cjs'],['encoder.cjs'],{cwd,frameBytes:8,frames:1,signal:controller.signal});void work.catch(()=>{});while(!await fs.stat(path.join(cwd,'renderer.pid')).catch(()=>undefined)||!await fs.stat(path.join(cwd,'encoder.pid')).catch(()=>undefined))await new Promise(r=>setTimeout(r,5));controller.abort();await assert.rejects(work,/JOB_CANCELLED/);await exited(cwd);}finally{await fs.rm(cwd,{recursive:true,force:true});}
});
test('truncated successful render is rejected rather than encoding a partial window',{timeout:5000},async()=>{
 const cwd=await fixture("process.stdout.write(Buffer.alloc(8));","process.stdin.resume();process.stdin.on('end',()=>process.exit(0));");try{await assert.rejects(renderTextFramePipeline(process.execPath,['renderer.cjs'],['encoder.cjs'],{cwd,frameBytes:8,frames:1}),/TEXT_RASTER_PIXELS_INVALID/);await exited(cwd);}finally{await fs.rm(cwd,{recursive:true,force:true});}
});
test('timeout escalates for a subprocess that ignores SIGTERM and leaves no owned process',{timeout:6000},async()=>{
 const cwd=await fixture("process.on('SIGTERM',()=>{});process.stdout.write(Buffer.alloc(8));setInterval(()=>{},1000);","process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);");try{await assert.rejects(renderTextFramePipeline(process.execPath,['renderer.cjs'],['encoder.cjs'],{cwd,frameBytes:8,frames:1,timeout:100}),/MEDIA_PROCESS_TIMEOUT/);await exited(cwd);}finally{await fs.rm(cwd,{recursive:true,force:true});}
});
