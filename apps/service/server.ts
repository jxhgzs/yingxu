import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes, randomUUID} from 'node:crypto';
import {Store} from './store.ts';
import {Jobs} from './jobs.ts';
import {TextRasters} from './text-raster.ts';
import {CurveAudioRenders} from './curve-audio.ts';
import {json, body, serveFile} from './http.ts';
import {detectCfr30} from '../../packages/media/src/frame-timing.ts';
import {probeAsset, ffmpeg} from '../../packages/media/src/probe.ts';
import {runProcess} from '../../packages/media/src/process.ts';
import {importJianying} from '../../packages/jianying/src/import.ts';
import {check, emptyDocument, validateDocument} from '../../packages/core/src/document.ts';
import {rational} from '../../packages/core/src/time.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const mime: Record<string, string> = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json'};
export async function startServer(options: {root?: string; port?: number; dist?: string} = {}) {
  const version=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8')).version;
  const store = new Store(options.root || process.env.YINGXU_EDITOR_DATA || path.join(repo, '.local'));
  await store.initialize(); const jobs = new Jobs(store); await jobs.initialize();
  const textRasters=new TextRasters(store,{engine:jobs.engine});
  const curveAudio=new CurveAudioRenders(store,{engine:jobs.engine});
  const token = randomBytes(24).toString('hex');
  async function registerFile(file: string, name: string) {
    const asset = await probeAsset(file, name);
    const frameTiming=await detectCfr30(asset);if(frameTiming)asset.frameTiming=frameTiming;
    const extension = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12) || '.media';
    const destination = path.join(store.root, 'media', asset.id + extension);
    if (!store.assets.has(asset.id)) {await fs.copyFile(file, destination); asset.path = destination;}
    return await store.addAsset(asset,{...(frameTiming?{verifiedFrameTiming:frameTiming}:{})});
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1'); const route = url.pathname;
      const origin = request.headers.origin;
      if (origin) {
        let parsed: URL; try {parsed = new URL(origin);} catch {throw Error('ORIGIN_REJECTED');}
        check(['127.0.0.1', 'localhost'].includes(parsed.hostname) && (parsed.port === String((server.address() as any)?.port) || parsed.port === '8816'), 'ORIGIN_REJECTED');
      }
      check(['127.0.0.1', 'localhost'].includes(new URL('http://' + request.headers.host).hostname), 'HOST_REJECTED');
      if (!['GET', 'HEAD'].includes(request.method || '')) check(request.headers['x-editor-token'] === token, 'INVALID_SESSION_TOKEN');
      const respond = (v: unknown, status = 200) => json(response, status, v);
      let match: RegExpExecArray | null;
      if (route === '/api/bootstrap' && request.method === 'GET') return respond({token, version, engine:jobs.engine, projects: store.list(), assets: [...store.assets.values()],
        capabilities: ['video', 'audio', 'image', 'text', 'split', 'trim', 'speed', 'curve-speed', 'curve-audio', 'audio-fade', 'subtitle-import', 'asset-relink', 'known-draft-keyframes', 'transform', 'color-adjustments', 'transitions', 'webgl2-preview', 'gpu-static-text', 'text-animation', 'gpu-text-animation', 'temperature-tint', 'gpu-silent-curve', 'gpu-curve-audio', 'multitrack', 'history', 'preview', 'export', 'source-clock-keyframes', 'export-settings', 'mp4', 'mov', 'gif', 'mp3', 'wav', 'm4a', 'hevc'],
        limitations: ['不支持未解析的剪映特效与关键帧渲染', 'GPU支持七项调节、已验证叠化/闪黑及文字动画；部分文字使用精确逐帧纹理，冷帧需等待；曲线声音需先准备音轨，超缓存限制或未知样式回退后台预览；零余量转场只支持逐帧验证的30fps恒速素材']});
      if (route === '/api/projects' && request.method === 'GET') return respond(store.list());
      if (route === '/api/projects' && request.method === 'POST') {
        const input = await body(request), doc = emptyDocument(); if (typeof input.title === 'string') doc.title = input.title.slice(0, 200);
        return respond(await store.create(doc), 201);
      }
      if (route === '/api/demo' && request.method === 'POST') {
        let fixture = path.join(repo,'fixtures/timeline-probe.mp4');
        try {await fs.access(fixture);} catch {fixture=path.resolve(repo, '../剪映5.9.0复刻分析_20261018/fixtures/timeline-probe.mp4');}
        const asset = await registerFile(fixture, '动态测试素材.mp4'), doc = emptyDocument(); doc.title = '剪辑练习';
        doc.canvas = {width: 1280, height: 720}; doc.assets.push(asset);
        doc.tracks[0].clips.push({id: randomUUID(), materialId: asset.id, source: {start: rational(0), duration: rational(6)},
          target: {start: rational(0), duration: rational(6)}, speed: rational(1), editableTiming: true});
        return respond({project: await store.create(doc), asset}, 201);
      }
      if (route === '/api/open-document' && request.method === 'POST') {
        const input = await body(request), doc = input.document;
        validateDocument(doc);
        // Relink only to registered immutable uploads; never follow arbitrary paths in an imported JSON.
        for (const a of doc.assets) if (a.kind !== 'text') {
          const registered = store.assets.get(a.id);
          if (registered && registered.sha256 === a.sha256) Object.assign(a, registered);
        }
        if(input.provenance){
          check(input.provenance&&typeof input.provenance==='object'&&input.provenance.raw&&typeof input.provenance.sha256==='string','INVALID_SOURCE_PROVENANCE');
          const source=importJianying(input.provenance.raw);
          check(source.provenance.sha256===input.provenance.sha256,'SOURCE_HASH_MISMATCH');
          return respond(await store.create(doc,{diagnostics:source.diagnostics,provenance:source.provenance}),201);
        }
        check(!input.diagnostics?.length, 'SOURCE_PROJECT_REQUIRES_DRAFT_IMPORT');
        return respond(await store.create(doc), 201);
      }
      if (route === '/api/import-draft' && request.method === 'POST') {
        const input = await body(request), imported = importJianying(input);
        imported.document.title = typeof input.name === 'string' ? input.name : '导入的剪映草稿';
        return respond(await store.create(imported.document, {diagnostics: imported.diagnostics, provenance: imported.provenance}), 201);
      }
      if (route === '/api/assets' && request.method === 'GET') return respond([...store.assets.values()]);
      if (route === '/api/assets' && request.method === 'POST') {
        const rawName = request.headers['x-filename']; check(typeof rawName === 'string', 'FILENAME_REQUIRED');
        const name = path.basename(decodeURIComponent(rawName)).slice(0, 200);
        const temp = path.join(store.root, 'media', randomUUID() + '.upload'); let total = 0;
        const handle = await fs.open(temp, 'wx', 0o600);
        try {
          for await (const chunk of request) {total += chunk.length; check(total <= 512 * 1024 * 1024, 'UPLOAD_TOO_LARGE'); await handle.write(chunk);}
          await handle.close(); return respond(await registerFile(temp, name), 201);
        } finally {await handle.close().catch(() => {}); await fs.rm(temp, {force: true});}
      }
      if ((match = /^\/api\/projects\/([a-f0-9-]+)$/.exec(route)) && request.method === 'GET') return respond({...store.state(match[1]), jobs: jobs.list(match[1])});
      if ((match = /^\/api\/projects\/([a-f0-9-]+)\/curve-audio$/.exec(route)) && request.method === 'POST') {
        const input=await body(request),controller=new AbortController();
        const disconnected=()=>{if(!response.writableEnded)controller.abort();};response.once('close',disconnected);
        try{return respond(await curveAudio.request(match[1],input,controller.signal));}
        finally{response.removeListener('close',disconnected);}
      }
      if ((match = /^\/curve-audio\/([a-f0-9]{64})\.wav$/.exec(route)) && ['GET','HEAD'].includes(request.method||''))
        return await serveFile(request,response,await curveAudio.file(match[1]),'audio/wav');
      if ((match = /^\/api\/projects\/([a-f0-9-]+)\/textures$/.exec(route)) && request.method === 'POST') {
        const input=await body(request),controller=new AbortController();
        const disconnected=()=>{if(!response.writableEnded)controller.abort();};response.once('close',disconnected);
        try{return respond(await textRasters.request(match[1],input,controller.signal));}
        finally{response.removeListener('close',disconnected);}
      }
      if ((match = /^\/text-renders\/([a-f0-9]{64})\.png$/.exec(route)) && ['GET','HEAD'].includes(request.method||''))
        return await serveFile(request,response,await textRasters.file(match[1]),'image/png');
      if ((match = /^\/api\/projects\/([a-f0-9-]+)\/commands$/.exec(route)) && request.method === 'POST') {
        const input = await body(request), project = store.get(match[1]);
        check(project.diagnostics.length === 0, 'SOURCE_DRAFT_READ_ONLY');
        const edits=input.command?.type==='batch'?input.command.commands:[input.command];
        if(Array.isArray(edits))for(const edit of edits){
          if (edit?.type === 'asset.add' && edit.asset?.kind !== 'text') {
            const registered = store.assets.get(edit.asset?.id); check(registered, 'MEDIA_NOT_LINKED');edit.asset = registered;
          }else if(edit?.type==='asset.relink'){
            const registered=store.assets.get(edit.replacement?.id);check(registered,'MEDIA_NOT_LINKED');edit.replacement=registered;
          }
        }
        return respond(await store.edit(match[1], input));
      }
      if ((match = /^\/api\/projects\/([a-f0-9-]+)\/download$/.exec(route)) && request.method === 'GET') {
        const p = store.get(match[1]); response.writeHead(200, {'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((p.document.title || '工程') + '.yingxu.json')}`});
        response.end(JSON.stringify({format: 'yingxu-editor', version: 1, document: p.document, diagnostics: p.diagnostics, provenance: p.provenance}, null, 2)); return;
      }
      if ((match = /^\/api\/projects\/([a-f0-9-]+)\/jobs$/.exec(route))) {
        if (request.method === 'GET') return respond(jobs.list(match[1]));
        if (request.method === 'POST') return respond(await jobs.submit(match[1], await body(request)), 202);
      }
      if ((match = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(route)) && request.method === 'GET') return respond(jobs.public(jobs.get(match[1])));
      if ((match = /^\/api\/jobs\/([a-f0-9-]+)\/cancel$/.exec(route)) && request.method === 'POST') return respond(await jobs.cancel(match[1]));
      if ((match = /^\/media\/([a-zA-Z0-9_-]+)(\/thumb)?$/.exec(route)) && ['GET', 'HEAD'].includes(request.method || '')) {
        const asset = store.assets.get(match[1]); check(asset, 'MEDIA_NOT_FOUND');
        if (match[2]) {
          const thumb = path.join(store.root, 'media', asset.id + '.thumb.png');
          try {await fs.access(thumb);} catch {
            const filter = asset.kind === 'audio' ? 'showwavespic=s=320x100:colors=0x54cbb2' : 'scale=320:180:force_original_aspect_ratio=decrease';
            const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', asset.path, ...(asset.kind === 'audio' ? ['-filter_complex', filter] : ['-vf', filter]), '-frames:v', '1', thumb];
            await runProcess(ffmpeg(), args, {timeout: 30000});
          }
          return await serveFile(request, response, thumb, 'image/png');
        }
        const extension = path.extname(asset.path).toLowerCase();
        const mediaMime: Record<string, string> = {'.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'};
        return await serveFile(request, response, asset.path, mediaMime[extension] || 'application/octet-stream');
      }
      if ((match = /^\/renders\/([a-f0-9-]+)\/(video|download)$/.exec(route)) && ['GET', 'HEAD'].includes(request.method || '')) {
        const job = jobs.get(match[1]); check(job.status === 'completed' && job.result, 'JOB_NOT_COMPLETED');
        const extension=job.result.extension||'mp4';let name=path.basename(url.searchParams.get('name')||'映序导出.'+extension).slice(0,200);
        if(!name.toLowerCase().endsWith('.'+extension))name+='.'+extension;
        return await serveFile(request, response, job.result.path, job.result.mime||'video/mp4', match[2] === 'download' ? name : undefined);
      }
      check(request.method === 'GET' || request.method === 'HEAD', 'ROUTE_NOT_FOUND');
      const dist = options.dist || path.join(repo, 'dist');
      const relative = route === '/' ? 'index.html' : decodeURIComponent(route).slice(1), file = path.resolve(dist, relative);
      check(file.startsWith(path.resolve(dist) + path.sep), 'ROUTE_NOT_FOUND');
      return await serveFile(request, response, file, mime[path.extname(file)] || 'application/octet-stream');
    } catch (error: any) {
      if (response.headersSent) {response.destroy(); return;}
      const message = error instanceof Error ? error.message : String(error);
      const status = /CONFLICT/.test(message) ? 409 : /NOT_FOUND|ENOENT/.test(message) ? 404 : /REJECTED|TOKEN/.test(message) ? 403 : 400;
      json(response, status, {error: message});
    }
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(options.port ?? Number(process.env.PORT || 8815), '127.0.0.1', resolve);});
  let closing: Promise<void> | undefined;
  const close = () => closing ||= (async () => {
    await textRasters.shutdown();await curveAudio.shutdown();
    await jobs.shutdown();
    const closed = new Promise<void>(resolve=>server.close(()=>resolve()));
    server.closeAllConnections(); await closed;
  })();
  return {server, store, jobs, token, close, origin: `http://127.0.0.1:${(server.address() as any).port}`};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const instance = await startServer(); process.stdout.write(`映序编辑器 ${instance.origin}\n`);
  const stop = () => {void instance.close().finally(()=>process.exit(0));};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
