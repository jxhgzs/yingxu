import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {startServer} from '../../../apps/service/server.ts';
const here=path.resolve('artifacts/qa/scrub-v11'),app=await startServer({root:path.join(here,'service-data'),port:8872,dist:path.resolve('dist')});
const proxy=http.createServer(async(req,res)=>{try{
 if(req.url==='/__qa/probe.js'){res.setHeader('content-type','text/javascript');return res.end(await fs.readFile(path.join(here,'probe.js')));}
 if(req.url==='/__qa/result'&&req.method==='POST'){
  if(req.headers.origin!=='http://127.0.0.1:8873'||req.headers['x-editor-token']!==app.token){res.writeHead(403);return res.end();}
  let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>2e6)throw Error('too large');chunks.push(c);}
  const value=JSON.parse(Buffer.concat(chunks).toString());await fs.writeFile(path.join(here,'ui-trace.json'),JSON.stringify(value,null,2));res.end('ok');return;
 }
 const headers={...req.headers,host:'127.0.0.1:8872',...(req.headers.origin?{origin:app.origin}:{})};const upstream=http.request(app.origin+req.url,{method:req.method,headers},incoming=>{
  if(req.url==='/'&&req.method==='GET'){const chunks=[];incoming.on('data',c=>chunks.push(c));incoming.on('end',()=>{const html=Buffer.concat(chunks).toString().replace('</body>','<script src="/__qa/probe.js"></script></body>');res.setHeader('content-type','text/html');res.end(html);});}
  else {res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);}
 });upstream.on('error',e=>{res.statusCode=500;res.end(String(e));});req.pipe(upstream);
 }catch(e){res.statusCode=500;res.end(String(e));}});await new Promise(r=>proxy.listen(8873,'127.0.0.1',r));console.log('READY',process.pid,app.origin);let closing=false;async function close(){if(closing)return;closing=true;proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await app.close();process.exit(0);}process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
