/**
 * Video colour interpretation policy, version 1 (2026-10-19).
 *
 * Plan/contract: preserve each supported source tag; fill missing fields using a
 * declared SD/HD product heuristic; mark every partial/untagged result assumed;
 * reject unsupported/HDR values before export rather than quietly converting.
 *
 * Only two untagged cases have native/browser evidence: 640x360 -> SMPTE170M
 * matrix/primaries, 1280x720 -> BT709 matrix/primaries; both BT709 transfer and
 * limited range. The width>=1280 OR height>576 threshold is our product policy,
 * not a recovered native rule for all dimensions, codecs, dates or platforms.
 *
 * This resolves metadata only. It performs no pixel conversion, does not alter
 * assets and cannot override HTMLVideoElement's browser-selected decode matrix.
 * Image profiles use a separate path. HDR/wide-gamut/tone mapping is unsupported.
 */
export type AssetColorSpace={matrix?:string;transfer?:string;primaries?:string;range?:string};
export type VideoColorMatrix='bt709'|'smpte170m'|'bt470bg'|'gbr';
export type VideoColorTransfer='bt709'|'iec61966-2-1';
export type VideoColorPrimaries='bt709'|'smpte170m'|'bt470bg';
export type VideoColorRange='tv'|'pc';
export type ResolvedVideoColorSpace={matrix:VideoColorMatrix;transfer:VideoColorTransfer;primaries:VideoColorPrimaries;range:VideoColorRange;assumed:boolean};
export type VideoColorSpaceAsset={kind?:string;width?:number;height?:number;colorSpace?:AssetColorSpace};
export const VIDEO_COLOR_SPACE_POLICY='sd-hd-heuristic-v1' as const;
const fields=['matrix','transfer','primaries','range'] as const;
const matrices:Record<string,VideoColorMatrix>={bt709:'bt709','709':'bt709',smpte170m:'smpte170m',bt470bg:'bt470bg',gbr:'gbr'};
const transfers:Record<string,VideoColorTransfer>={bt709:'bt709','709':'bt709','iec61966-2-1':'iec61966-2-1',srgb:'iec61966-2-1'};
const primaries:Record<string,VideoColorPrimaries>={bt709:'bt709','709':'bt709',smpte170m:'smpte170m',bt470bg:'bt470bg'};
const ranges:Record<string,VideoColorRange>={tv:'tv',pc:'pc'};
function unsupported(field:string):never{throw Error('UNSUPPORTED_VIDEO_COLOR_SPACE: '+field);}
function tagged<T extends string>(value:unknown,supported:Record<string,T>,field:string):T|undefined{
 if(value===undefined)return;
 if(typeof value!=='string'||!Object.hasOwn(supported,value))unsupported(field);
 return supported[value];
}

export function resolveVideoColorSpace(asset:VideoColorSpaceAsset):ResolvedVideoColorSpace{
 if(!asset||typeof asset!=='object'||Array.isArray(asset)||asset.kind!==undefined&&asset.kind!=='video')unsupported('media kind');
 const raw=asset.colorSpace;
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!fields.includes(key as typeof fields[number]))))unsupported('metadata');
 const matrix=tagged(raw?.matrix,matrices,'matrix'),transfer=tagged(raw?.transfer,transfers,'transfer'),primary=tagged(raw?.primaries,primaries,'primaries'),range=tagged(raw?.range,ranges,'range');
 const assumed=matrix===undefined||transfer===undefined||primary===undefined||range===undefined;
 if(!assumed)return {matrix,transfer,primaries:primary,range,assumed:false};
 // Do not invent a resolution classification if dimensions have not been probed.
 if(!Number.isSafeInteger(asset.width)||!Number.isSafeInteger(asset.height)||asset.width!<=0||asset.height!<=0)unsupported('dimensions required for missing tags');
 const hd=asset.width!>=1280||asset.height!>576,fallback=hd?'bt709':'smpte170m';
 return {matrix:matrix??fallback,transfer:transfer??'bt709',primaries:primary??fallback,range:range??'tv',assumed:true};
}
