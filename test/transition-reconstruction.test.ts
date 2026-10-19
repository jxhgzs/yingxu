import {test} from 'node:test';import assert from 'node:assert/strict';
import {reconstructSpatialEdge} from '../packages/core/src/transition-edge.ts';
// Independent constant-colour420 fixture: Y is B at x597/598; UV at the
// adjacent cosited anchors is respectively A/B. Centered upsampling weights
// are 3/4+1/4 and1/4+3/4, not a single block UV value.
const A=[231/255,44/255,38/255] as const,B=[31/255,172/255,215/255] as const;
const sample=(side:'outgoing'|'incoming',_x:number,_y:number)=>side==='outgoing'?A:B;
const cases=[
 {x:597,expected:[0.8906575057077626,0.481960530835599,0.5086467914220483]},
 {x:598,expected:[0.3774414342791912,0.6119396225981429,0.7323128628506197]},
];
test('centered420 reconstruction interpolates selected UV on both sides of the source boundary',()=>{
 for(const {x,expected}of cases){const actual=reconstructSpatialEdge(B,x===597?A:B,{kind:'wipeLeft',progress:16/30,x,y:201,width:1280,height:720,sample});actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<1e-9,`x${x} channel${i}: ${v} vs independently reconstructed ${expected[i]}`));}
});
