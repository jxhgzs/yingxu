// Independent CPU scalar reference. Does not import product reconstruction code.
const W=1280,H=720,K=[1,3,3,1];type Side={raw:Uint8Array;y:Uint8Array;uv:Uint8Array;alphaMin:number};const cache=new Map<string,Side>();
function same(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function side(raw:Uint8Array,key:string):Side{
 const old=cache.get(key);if(old&&same(raw,old.raw))return old;
 let alphaMin=255;const y=new Uint8Array(W*H),uv=new Uint8Array(W/2*H/2*2);
 for(let p=0;p<W*H;p++){const i=p*4;alphaMin=Math.min(alphaMin,raw[i+3]);y[p]=Math.floor((.2126*raw[i]+.7152*raw[i+1]+.0722*raw[i+2])/255*219+16+.5);}
 for(let cy=0;cy<H/2;cy++)for(let cx=0;cx<W/2;cx++){
  let r=0,g=0,b=0;for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){const x=Math.max(0,Math.min(W-1,2*cx+dx-1)),y=Math.max(0,Math.min(H-1,2*cy+dy-1)),i=(y*W+x)*4,w=K[dx]*K[dy];r+=raw[i]*w;g+=raw[i+1]*w;b+=raw[i+2]*w;}
  r/=64*255;g/=64*255;b/=64*255;const yy=.2126*r+.7152*g+.0722*b,i=(cy*W/2+cx)*2;uv[i]=Math.floor((b-yy)/(2*(1-.0722))*224+128+.5);uv[i+1]=Math.floor((r-yy)/(2*(1-.2126))*224+128+.5);
 }
 const result={raw,y,uv,alphaMin};cache.set(key,result);return result;
}
export function fullReference(a:Uint8Array,b:Uint8Array,kind:string,p:number,actualUV?:Uint8Array){
 const A=side(a,'A'),B=side(b,'B'),uv=new Uint8Array(W/2*H/2*4),radius=p*Math.hypot(W,H)/2,threshold=W*(1-p);const isA=(x:number,y:number)=>kind==='wipeLeft'?x<=threshold:Math.hypot(x-W/2,y-H/2)>=radius;
 for(let cy=0;cy<H/2;cy++)for(let cx=0;cx<W/2;cx++){const from=isA(2*cx+.5,2*cy+.5)?A:B,index=cy*W/2+cx;uv[index*4]=from.uv[index*2];uv[index*4+1]=from.uv[index*2+1];uv[index*4+3]=255;}
 const chosen=actualUV||uv,expected=new Float32Array(W*H*4);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const fx=(x-.5)/2,fy=(y-.5)/2,x0=Math.floor(fx),y0=Math.floor(fy),dx=fx-x0,dy=fy-y0;let U=0,V=0;
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){const cx=Math.max(0,Math.min(W/2-1,x0+i)),cy=Math.max(0,Math.min(H/2-1,y0+j)),index=(cy*W/2+cx)*4,weight=(i?dx:1-dx)*(j?dy:1-dy);U+=(chosen[index]-128)/224*weight;V+=(chosen[index+1]-128)/224*weight;}
  const index=y*W+x,Y=((isA(x+.5,y+.5)?A:B).y[index]-16)/219,r=Y+2*(1-.2126)*V,bl=Y+2*(1-.0722)*U,g=(Y-.2126*r-.0722*bl)/.7152;expected[index*4]=Math.max(0,Math.min(1,r))*255;expected[index*4+1]=Math.max(0,Math.min(1,g))*255;expected[index*4+2]=Math.max(0,Math.min(1,bl))*255;expected[index*4+3]=255;
 }
 return {expected,uv,minSourceAlpha:Math.min(A.alphaMin,B.alphaMin)};
}
export function chromaDiff(a:Uint8Array,b:Uint8Array){let sum=0,max=0,over0=0;let worst:any;for(let i=0;i<a.length;i++)if(i%4<2){const d=Math.abs(a[i]-b[i]);sum+=d;if(d>0)over0++;if(d>max){max=d;const pixel=i>>>2;worst={x:pixel%640,y:Math.floor(pixel/640),channel:i%4,actual:a[i],expected:b[i]};}}return{meanUV:sum/(640*360*2),maxUV:max,nonEqual:over0,worst};}
