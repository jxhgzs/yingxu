// QA preparation only: ffprobe/hash/JSON/files. Never invokes FFmpeg or native UI.
import fs from 'node:fs/promises';import path from 'node:path';
import {probeAsset} from '../../../packages/media/src/probe.ts';
import {importJianying} from '../../../packages/jianying/src/import.ts';
import {spatialEdgePolicy,spatialReconstruction} from '../../../packages/core/src/transition-edge.ts';
import {resolveVideoColorSpace} from '../../../packages/core/src/color-space.ts';
const here=path.resolve('artifacts/qa/plane-edges-v10');await fs.mkdir(here,{recursive:true});const cases=[],media=new Map();
for(const [id,kind,draft,nativeFile]of [
 ['wipe','wipeLeft','19-wipe-canvas720-native.json','/Users/tal/Downloads/yingxu-native-wipe-canvas720-v8-2004.mov'],
 ['circle','circleOpen','18-circle-canvas720-native.json','/Users/tal/Downloads/yingxu-native-circle-canvas720-v8-2002.mov']]){
 const raw=JSON.parse(await fs.readFile('evidence/2026-10-19-rea-transitions-v8/'+draft,'utf8')),doc=importJianying(raw).document;
 const source=await probeAsset(doc.assets[0].path),native=await probeAsset(nativeFile);media.set(source.id,source);media.set(native.id,native);
 const ids=new Set(doc.assets.map(a=>a.id));doc.assets=[source];for(const track of doc.tracks)for(const clip of track.clips)if(ids.has(clip.materialId))clip.materialId=source.id;
 const transition=doc.transitions[0],policy=spatialEdgePolicy(doc,transition);if(policy!=='bt709-cosited420-v1'||spatialReconstruction(doc,transition)!=='centered-bilinear444-v2')throw Error('QUALIFICATION '+id);
 if(transition.kind!==kind||source.width!==1280||source.height!==720||native.width!==1280||native.height!==720)throw Error('SIZE '+id);
 for(const asset of [source,native]){const c=resolveVideoColorSpace(asset);if(c.matrix!=='bt709'||c.range!=='tv')throw Error('COLOR '+id);}
 const unknown=structuredClone(doc);for(const asset of unknown.assets)delete asset.pixelFormat;if(spatialEdgePolicy(unknown,unknown.transitions[0])!==undefined)throw Error('UNKNOWN_ADMITTED');
 cases.push({id,kind,document:doc,unknownDocument:unknown,native,source,expectedPolicy:policy,frames:Array.from({length:30},(_,i)=>45+i),captureFrame:id==='wipe'?61:60,draft});
}
const record={createdAt:new Date().toISOString(),media:[...media.values()],cases,scope:'New plane policy only; actual clicks later. Source pixelFormat is original ffprobe pix_fmt; no guessed alpha status; no FFmpeg/native UI calls.'};
await fs.writeFile(path.join(here,'cases.json'),JSON.stringify(record,null,2));console.log('PLANE_QA_PREPARED',cases.map(c=>({id:c.id,format:c.source.pixelFormat,sha:c.source.sha256,policy:c.expectedPolicy})));
