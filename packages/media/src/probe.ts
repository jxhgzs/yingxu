import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runProcess} from './process.ts';
import {decimal, rational} from '../../core/src/time.ts';
import type {Asset} from '../../core/src/document.ts';

export const ffmpeg = () => process.env.YINGXU_FFMPEG || '/opt/homebrew/bin/ffmpeg';
export const ffprobe = () => process.env.YINGXU_FFPROBE || '/opt/homebrew/bin/ffprobe';
export async function fileHash(file: string): Promise<string> {
  const h = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex');
}
export async function probe(file: string): Promise<any> {
  const result = await runProcess(ffprobe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {timeout: 30000});
  return JSON.parse(result.stdout);
}
export async function probeAsset(file: string, name = path.basename(file)): Promise<Asset> {
  const p = await probe(file), video = p.streams?.find((s: any) => s.codec_type === 'video'), audio = p.streams?.find((s: any) => s.codec_type === 'audio');
  if (!video && !audio) throw Error('NO_MEDIA_STREAM');
  const still = !!video && ['png', 'mjpeg', 'webp', 'bmp', 'tiff'].includes(video.codec_name) && !audio &&
    !p.format?.duration && (!video.nb_frames || Number(video.nb_frames) <= 1);
  const kind = still ? 'image' : video ? 'video' : 'audio';
  const duration = still ? rational(3600) : decimal(String(video?.duration || p.format?.duration || audio?.duration || '0'));
  if (Number(duration.numerator) <= 0) throw Error('MEDIA_DURATION_UNAVAILABLE');
  const sha256 = await fileHash(file);
  const fpsString = video?.avg_frame_rate && video.avg_frame_rate !== '0/0' ? video.avg_frame_rate : video?.r_frame_rate;
  const rate = fpsString?.match(/^(\d+)\/(\d+)$/);
  return {id: 'a_' + sha256.slice(0, 24), path: file, name, kind, duration, width: video?.width, height: video?.height,
    hasAudio: !!audio, sha256, fps: rate && rate[2] !== '0' && rate[1] !== '0' ? rational(rate[1], rate[2]) : undefined,
    mime: kind === 'image' ? `image/${video.codec_name === 'mjpeg' ? 'jpeg' : video.codec_name}` : kind === 'audio' ? 'audio/mp4' : 'video/mp4'};
}
