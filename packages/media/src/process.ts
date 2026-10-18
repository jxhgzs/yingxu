import {spawn} from 'node:child_process';

export async function runProcess(binary: string, args: string[], options: {signal?: AbortSignal; onLine?: (line: string) => void; timeout?: number; cwd?: string} = {}) {
  if (options.signal?.aborted) throw Error('JOB_CANCELLED');
  return await new Promise<{stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe'], cwd: options.cwd});
    let stdout = '', stderr = '', lines = '', cancelled = false, timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {cancelled = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);};
    options.signal?.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(() => {timedOut = true; child.kill('SIGKILL');}, options.timeout ?? 120000);
    const cleanup = () => {clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', cancel);};
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => {
      stdout = (stdout + s).slice(-2_000_000); lines += s;
      const complete = lines.split(/\r?\n/); lines = complete.pop()!;
      for (const line of complete) options.onLine?.(line);
    });
    child.stderr.on('data', (s: string) => {stderr = (stderr + s).slice(-32000);});
    child.on('error', e => {cleanup(); reject(e);});
    child.on('close', code => {
      cleanup();
      if (cancelled) reject(Error('JOB_CANCELLED'));
      else if (timedOut) reject(Error('MEDIA_PROCESS_TIMEOUT'));
      else if (code !== 0) reject(Error(`MEDIA_PROCESS_FAILED (${code}): ${stderr.slice(-6000)}`));
      else resolve({stdout, stderr});
    });
  });
}
