import fs from 'node:fs';
import path from 'node:path';

export type MediaTool='ffmpeg'|'ffprobe'|'rubberband';
const variables:Record<MediaTool,string>={ffmpeg:'YINGXU_FFMPEG',ffprobe:'YINGXU_FFPROBE',rubberband:'YINGXU_RUBBERBAND'};
function executable(file:string){try{return fs.statSync(file).isFile()&&(fs.accessSync(file,fs.constants.X_OK),true);}catch{return false;}}
/** Finder has a minimal PATH; standard macOS install locations remain discoverable. */
export function findMediaTool(name:MediaTool,options:{env?:NodeJS.ProcessEnv;fallbackDirectories?:string[]}={}):string|undefined{
 const env=options.env??process.env,override=env[variables[name]],command=override||name;
 if(path.isAbsolute(command)||command.includes(path.sep)){
  const file=path.resolve(command);return executable(file)?file:undefined;
 }
 const directories=[...(env.PATH||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir)),...(options.fallbackDirectories??(process.platform==='darwin'?['/opt/homebrew/bin','/usr/local/bin']:[]))];
 for(const directory of directories){const file=path.join(directory,command);if(executable(file))return file;}
 return undefined;
}
/** Preserve invalid explicit overrides: never silently swap a configured engine. */
export function mediaTool(name:MediaTool):string{return findMediaTool(name)||process.env[variables[name]]||name;}
export const rubberband=()=>mediaTool('rubberband');
