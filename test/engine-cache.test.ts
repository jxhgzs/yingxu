import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {rendererFingerprint} from '../apps/service/engine.ts';
test('preview identity changes with render code, bundled font bytes and packaged bundle',{timeout:10000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-engine-'));try{
  for(const directory of ['packages/core/src','packages/media/src','assets/fonts'])await fs.mkdir(path.join(root,directory),{recursive:true});
  const source=path.join(root,'packages/media/src/render.ts'),font=path.join(root,'assets/fonts/font.otf'),bundle=path.join(root,'service.mjs');
  await fs.writeFile(source,'render1');await fs.writeFile(font,'font1');await fs.writeFile(bundle,'bundle1');const a=await rendererFingerprint(root,bundle);assert.equal(a,await rendererFingerprint(root,bundle));
  await fs.writeFile(source,'render2');const b=await rendererFingerprint(root,bundle);assert.notEqual(a,b);await fs.writeFile(font,'font2');const c=await rendererFingerprint(root,bundle);assert.notEqual(b,c);
  await fs.rm(path.join(root,'packages'),{recursive:true});const d=await rendererFingerprint(root,bundle);await fs.writeFile(bundle,'bundle2');assert.notEqual(d,await rendererFingerprint(root,bundle));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
