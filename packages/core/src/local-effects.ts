import type {TextAnimation} from './text-animation.ts';
export type LocalEffect = {
 key:string;resourceId:string;name:string;category:'text'|'sequence'|'sticker'|'font'|'other';
 available:boolean;paid:'observed-paid'|'unknown';reason:string;
 animation?:Pick<TextAnimation,'phase'|'kind'>;
};
export type LocalEffectCatalog={entries:LocalEffect[];scannedAt:string;missingRoots:number};
