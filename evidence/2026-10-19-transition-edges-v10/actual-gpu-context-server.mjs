// One QA-only port. Does not construct Jobs/startServer or invoke FFmpeg.
import {createServer}from'vite';import fs from'node:fs/promises';import path from'node:path';import {randomBytes,createHash}from'node:crypto';import{serveFile}from'../../../apps/service/http.ts';
const root=process.cwd(),here=path.join(root,'artifacts/qa/plane-edges-v10'),data=JSON.parse(await fs.readFile(path.join(here,'cases.json'),'utf8')),token=randomBytes(24).toString('hex'),origin='http://127.0.0.1:8841';
const hashes={};for(const file of ['apps/editor/src/preview/webgl.ts','apps/editor/src/preview/plan.ts','packages/core/src/transition-edge.ts','artifacts/qa/plane-edges-v10/probe.ts','artifacts/qa/plane-edges-v10/reference.ts','artifacts/qa/plane-edges-v10/context.ts'])hashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
const media=new Map(data.media.map(a=>[a.id,a]));
const vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:8841,strictPort:true,hmr:false,watch:null},plugins:[{name:'plane-qa',configureServer(server){server.middlewares.use(async(req,res,next)=>{try{
 const url=new URL(req.url||'/',origin);
 if(url.pathname==='/api/bootstrap'){res.setHeader('content-type','application/json');res.end(JSON.stringify({token,sourceHashes:hashes,notice:'QA-only server, no render jobs; idle until human button click.'}));return;}
 const file=/^\/media\/([a-z0-9_]+)$/.exec(url.pathname);if(file){const asset=media.get(file[1]);if(!asset){res.statusCode=404;res.end();return;}await serveFile(req,res,asset.path,asset.path.endsWith('.mov')?'video/quicktime':'video/mp4');return;}
 const out=/^\/artifacts\/qa\/plane-edges-v10\/(result\.json|context-result\.json|capture-[a-z0-9-]{1,80}\.rgba)$/.exec(url.pathname);if(out&&req.method==='POST'){
  if(req.headers.origin!==origin||req.headers['x-editor-token']!==token){res.statusCode=403;res.end('origin/token');return;}
  const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8*1024*1024){res.statusCode=413;res.end('large');return;}chunks.push(chunk);}const body=Buffer.concat(chunks);if(out[1].endsWith('.json'))JSON.parse(body.toString());await fs.writeFile(path.join(here,out[1]),body);res.end('ok');return;
 }
 next();
 }catch(e){res.statusCode=500;res.end(String(e));}});}}]});await vite.listen();await fs.writeFile(path.join(here,'server-state.json'),JSON.stringify({pid:process.pid,origin,startedAt:new Date().toISOString(),sourceHashes:hashes,hmr:false,watch:false},null,2));console.log('PLANE_QA_READY',process.pid,origin+'/artifacts/qa/plane-edges-v10/');
let closing=false;async function stop(){if(closing)return;closing=true;await vite.close();process.exit(0);}process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
