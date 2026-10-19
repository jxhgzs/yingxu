import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const fontName='Source Han Sans SC Medium',fileName='SourceHanSansSC-Medium.otf';
/** Freeze the independently licensed font alongside each job, for preview/export parity. */
export async function prepareFonts(fonts:string[],directory:string):Promise<boolean>{
  if(!fonts.includes(fontName))return false;
  const candidates=[new URL('../../../assets/fonts/source-han-sans-1.000/',import.meta.url),new URL('../../assets/fonts/source-han-sans-1.000/',import.meta.url)];
  let source:string|undefined;
  for(const candidate of candidates){const file=path.join(fileURLToPath(candidate),fileName);try{await fs.access(file);source=file;break;}catch{}}
  if(!source)throw Error('FONT_UNAVAILABLE: '+fontName);
  const data=await fs.readFile(source),target=path.join(directory,'fonts');
  await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,fileName),data);
  await fs.writeFile(path.join(directory,'fonts.json'),JSON.stringify([{font:fontName,file:fileName,sha256:createHash('sha256').update(data).digest('hex')}],null,2));
  return true;
}
