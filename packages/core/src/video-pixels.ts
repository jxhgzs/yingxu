/** A deliberately finite list of probed FFmpeg pixel formats without an alpha
 * plane. Missing/unrecognised formats are unknown, never assumed opaque. */
const opaque=new Set(['yuv420p','yuv422p','yuv444p','yuv440p','yuv410p','yuv411p','yuvj420p','yuvj422p','yuvj444p','nv12','nv21','rgb24','bgr24','gray']);
export function isOpaqueVideoPixelFormat(value:unknown):boolean{return typeof value==='string'&&opaque.has(value);}
export function validVideoPixelFormat(value:unknown):value is string{return typeof value==='string'&&/^[a-z0-9_]{1,40}$/.test(value);}
