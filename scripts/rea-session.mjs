// Isolated local MCP test client. It does not modify any agent registration.
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '../artifacts/rea/runtime/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {StdioClientTransport} from '../artifacts/rea/runtime/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';
const root=path.resolve(process.argv[2]||'artifacts/rea/native-session');
await fs.mkdir(path.join(root,'inbox'),{recursive:true});
await fs.mkdir(path.join(root,'outbox'),{recursive:true});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('artifacts/rea/runtime/node_modules/rea-agents/scripts/rea.mjs'),'--mcp'],env:{...process.env},stderr:'pipe',maxBufferSize:128*1024*1024});
transport.stderr?.on('data',data=>{void fs.appendFile(path.join(root,'server.stderr.log'),data);});
const client=new Client({name:'yingxu-rea-verification',version:'1.0.0'});
const save=(name,value)=>fs.writeFile(path.join(root,name),JSON.stringify(value,null,2));
await client.connect(transport);
await save('server.json',{version:client.getServerVersion(),capabilities:client.getServerCapabilities(),pid:transport.pid});
await save('tools.json',await client.listTools());
console.log('MCP_READY',root);
const done=new Set(await fs.readdir(path.join(root,'outbox')));
try {
  while(true){
    try{await fs.access(path.join(root,'STOP'));break;}catch{}
    for(const file of (await fs.readdir(path.join(root,'inbox'))).filter(s=>/^\d+.*\.json$/.test(s)).sort()){
      if(done.has(file))continue;
      const input=JSON.parse(await fs.readFile(path.join(root,'inbox',file),'utf8')),start=performance.now();
      console.log('REQUEST',file,input.name);
      let receipt;
      try{receipt={input,result:await client.callTool(input,{timeout:1200000}),elapsedSeconds:(performance.now()-start)/1000};}
      catch(error){receipt={input,error:{name:error.name,message:error.message,code:error.code,data:error.data},elapsedSeconds:(performance.now()-start)/1000};}
      await save('outbox/'+file,receipt);done.add(file);
      console.log('RESULT',file,receipt.elapsedSeconds,receipt.error?.message||receipt.result?.isError||'ok');
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
}finally{await client.close();}
