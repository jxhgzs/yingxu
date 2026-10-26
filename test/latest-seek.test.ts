import test from 'node:test';import assert from 'node:assert/strict';
import {LatestSeek} from '../apps/editor/src/preview/latest-seek.ts';
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('continuous seek keeps rendering while merging the backlog into the latest destination',async()=>{
 const first=deferred<number>(),last=deferred<number>(),calls:number[]=[],published:number[]=[],errors:unknown[]=[];
 const queue=new LatestSeek<number,number>(n=>{calls.push(n);return n===1?first.promise:last.promise;},n=>published.push(n),e=>errors.push(e));
 queue.request(1);queue.request(2);queue.request(3);assert.deepEqual(calls,[1]);first.resolve(1);await tick();
 assert.deepEqual(calls,[1,3]);assert.deepEqual(published,[1],'an active drag must still display completed frames');last.resolve(3);await tick();assert.deepEqual(published,[1,3]);assert.deepEqual(errors,[]);queue.dispose();
});
test('document reset discards stale completion and queued work but accepts the new document destination',async()=>{
 const old=deferred<number>(),calls:number[]=[],published:number[]=[];
 const queue=new LatestSeek<number,number>(n=>{calls.push(n);return n===1?old.promise:Promise.resolve(n);},n=>published.push(n),()=>assert.fail());
 queue.request(1);queue.request(2);queue.reset();queue.request(9);old.resolve(1);await tick();assert.deepEqual(calls,[1,9]);assert.deepEqual(published,[9]);queue.dispose();
});
test('seek errors do not lock the final destination, and disposal forbids late publication',async()=>{
 const failed=deferred<number>(),late=deferred<number>(),calls:number[]=[],published:number[]=[],errors:unknown[]=[];
 const queue=new LatestSeek<number,number>(n=>{calls.push(n);return n===1?failed.promise:late.promise;},n=>published.push(n),e=>errors.push(e));
 queue.request(1);queue.request(4);failed.reject(Error('decode'));await tick();assert.deepEqual(calls,[1,4]);assert.equal(errors.length,1);
 queue.request(5);queue.dispose();queue.request(6);late.resolve(4);await tick();assert.deepEqual(calls,[1,4]);assert.deepEqual(published,[]);
});
