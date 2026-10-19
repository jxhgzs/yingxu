import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
/** Code and bundled fonts are part of preview identity, including packaged service bundles. */
export async function rendererFingerprint(root=fileURLToPath(new URL('../../',import.meta.url)),bundle=fileURLToPath(import.meta.url)){
 const files:string[]=[];
 async function walk(directory:string){const entries=await fs.readdir(directory,{withFileTypes:true});for(const entry of entries){const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile()&&/\.(ts|mjs|otf|ttf|woff2|json)$/.test(file))files.push(file);}}
 try{await walk(path.join(root,'packages/core/src'));await walk(path.join(root,'packages/media/src'));}catch(error:any){if(error.code!=='ENOENT')throw error;files.length=0;files.push(bundle);}
 try{await walk(path.join(root,'assets/fonts'));}catch(error:any){if(error.code!=='ENOENT')throw error;}
 const hash=createHash('sha256');for(const file of files.sort()){hash.update(path.relative(root,file));hash.update('\0');hash.update(await fs.readFile(file));hash.update('\0');}
 return hash.digest('hex');
}
