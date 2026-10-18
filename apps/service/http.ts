import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';

export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); response.end(JSON.stringify(value));
}
export async function body(request: IncomingMessage, limit = 10 * 1024 * 1024) {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {bytes += chunk.length; if (bytes > limit) throw Error('BODY_TOO_LARGE'); chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function serveFile(request: IncomingMessage, response: ServerResponse, file: string, mime: string, downloadName?: string) {
  const stat = await fsp.stat(file); let start = 0, end = stat.size - 1, status = 200;
  const range = request.headers.range;
  const headers: Record<string, string | number> = {'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'};
  if (downloadName) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || !m[1] && !m[2]) {response.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); response.end(); return;}
    if (!m[1]) {start = Math.max(0, stat.size - Number(m[2]));}
    else {start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2]));}
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      response.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); response.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  response.writeHead(status, headers); if (request.method === 'HEAD' || stat.size === 0) {response.end(); return;}
  const stream = fs.createReadStream(file, {start, end}); stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy()); stream.pipe(response);
}
