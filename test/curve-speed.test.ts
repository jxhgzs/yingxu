import test from 'node:test';
import assert from 'node:assert/strict';
import {curveAverageSpeed,curveDuration,curveSourceDelta,curveTargetDelta,validateSpeedCurve,splitSpeedCurve,curveNearestFrame} from '../packages/core/src/curve-speed.ts';
import type {SpeedCurve} from '../packages/core/src/curve-speed.ts';
import {rational,micros,toNumber,sub} from '../packages/core/src/time.ts';

const peak:SpeedCurve={points:[{x:0,y:1},{x:.25,y:1},{x:.5,y:5.375},{x:.75,y:1},{x:1,y:1}]};
const flat=(speed:number):SpeedCurve=>({points:[{x:0,y:speed},{x:1,y:speed}]});

test('curve native average and raw source clock match the 5.9.0 custom curve',()=>{
  assert.equal(curveAverageSpeed(peak),1.5223880801349878);
  assert.deepEqual(curveDuration(peak,rational(3),rational(30)),micros(1966666));
  assert.deepEqual(curveSourceDelta(peak,rational(3),micros(1966666),micros(833333)),micros(876935));
  assert.deepEqual(curveSourceDelta(peak,rational(3),micros(1966666),micros(900000)),micros(1090693));
  assert.ok(Math.abs(toNumber(sub(curveTargetDelta(peak,rational(3),micros(1966666),micros(876935)),micros(833333))))<=.000001);
});

test('curve mapping preserves explicit duration and has stable flat, rising and falling inverses',()=>{
  assert.deepEqual(curveSourceDelta(flat(2),rational(3),rational(1),rational(1)),rational(2));
  assert.deepEqual(curveTargetDelta(flat(2),rational(3),rational(1),rational(3)),rational(1));
  assert.deepEqual(curveSourceDelta(flat(.1),rational(3),rational(30),rational(10)),rational(1));
  for(const curve of [flat(1),{points:[{x:0,y:.5},{x:.4,y:4},{x:1,y:1}]},{points:[{x:0,y:4},{x:1,y:.5}]}]){
    const D=curveDuration(curve,rational(4),rational(30));
    for(let i=0;i<=40;i++){
      const time=micros(Math.round(toNumber(D)*1000000*i/40));
      const source=curveSourceDelta(curve,rational(4),D,time);
      const back=curveTargetDelta(curve,rational(4),D,source);
      assert.ok(Math.abs(toNumber(sub(back,time)))<=.000002,`${i}: ${JSON.stringify(curve)}`);
    }
  }
});

test('curve domain rejects invalid clocks and float32 collapsed intervals',()=>{
  for(const curve of [flat(0),flat(11),flat(NaN),{points:[{x:0,y:1},{x:1,y:1},{x:1,y:1}]},
    {points:[{x:0,y:1},{x:.999999999,y:1},{x:1,y:1}]},{points:[{x:.1,y:1},{x:1,y:1}]}]){
    assert.throws(()=>validateSpeedCurve(curve),/INVALID_CURVE/);
  }
  assert.throws(()=>curveDuration(peak,rational(0),rational(30)),/INVALID_CURVE/);
  assert.throws(()=>curveDuration(peak,rational(3),rational(0)),/INVALID_CURVE/);
  assert.throws(()=>curveSourceDelta(peak,rational(3),rational(1),rational(-1)),/INVALID_CURVE/);
  assert.deepEqual(curveDuration(flat(1),micros(1001000),rational(30000,1001)),micros(1001000));
});

test('59 native export source frame observations match the recovered mapping at microsecond precision',()=>{
  const observed=[...Array.from({length:25},(_,i)=>i),26,29,32,37,42,47,52,57,60,63,65,...Array.from({length:23},(_,i)=>i+66)];
  const predicted=observed.map((_,frame)=>{
    const source=curveSourceDelta(peak,rational(3),micros(1966666),micros(Math.round(frame*1000000/30)));
    // The native mapper rounds to us; a frame boundary can lie up to 0.5 us above its rounded timestamp.
    return Math.floor((toNumber(source)*1000000+.5)*30/1000000);
  });
  assert.deepEqual(predicted,observed);
});

test('native non-node splits use raw clock for points and nearest source frame for ranges',()=>{
  const first=splitSpeedCurve(peak,rational(3),micros(1966666),micros(833333),rational(30));
  assert.deepEqual(first.rawSourceDelta,micros(876935));assert.deepEqual(first.sourceDelta,micros(866666));
  assert.equal(first.left.points[1].x,.8552515244151108);
  assert.equal(first.left.points.at(-1)!.y,1.3335384130477905);
  assert.equal(first.right.points[1].x,.29347429133566466);
  const second=splitSpeedCurve(peak,rational(3),micros(1966666),micros(900000),rational(30));
  assert.deepEqual(second.rawSourceDelta,micros(1090693));assert.deepEqual(second.sourceDelta,micros(1100000));
  assert.equal(second.left.points[1].x,.6876361923881043);
  assert.equal(second.left.points.at(-1)!.y,2.8881514072418213);
  assert.equal(second.right.points[1].x,.21437462857471448);
  assert.deepEqual(curveNearestFrame(micros(833333),rational(30)),micros(833333));
  assert.deepEqual(splitSpeedCurve(flat(1),rational(3),rational(3),micros(833333),rational(30)).sourceDelta,micros(833333));
  assert.throws(()=>splitSpeedCurve(peak,rational(3),micros(1966666),rational(0),rational(30)),/CURVE_SPLIT_EMPTY/);
});
