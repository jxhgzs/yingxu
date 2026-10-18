import test from 'node:test';
import assert from 'node:assert/strict';
import {rational, decimal, micros, add, sub, mul, div, compare, toNumber, frameTime, nearestFrame} from '../packages/core/src/time.ts';

test('NTSC 30000/1001 frame duration makes an exact round trip', () => {
  const fps = rational(30000, 1001);
  assert.deepEqual(mul(div(rational(1), fps), rational(30000)), rational(1001));
  assert.deepEqual(add(micros(33333), micros(1)), rational(16667, 500000));
  assert.deepEqual(nearestFrame(frameTime(113, fps), fps), rational(113));
});
test('decimal speeds and exponents remain exact', () => {
  assert.deepEqual(decimal('1.3'), rational(13, 10));
  assert.deepEqual(decimal('1e-3'), rational(1, 1000));
  assert.deepEqual(decimal('-1.25e2'), rational(-125));
  assert.deepEqual(div(rational(3), decimal('1.3')), rational(30, 13));
});
test('normalization handles zero, sign and arithmetic', () => {
  assert.deepEqual(rational(0, -50), rational(0));
  assert.deepEqual(rational(6, -8), rational(-3, 4));
  assert.equal(compare(sub(rational(1), rational(1, 3)), rational(2, 3)), 0);
  assert.equal(toNumber(rational(3, 2)), 1.5);
});
test('invalid values cannot enter exact time arithmetic', () => {
  for (const operation of [() => rational(1, 0), () => decimal('Infinity'), () => micros(0.5),
    () => micros(Number.MAX_SAFE_INTEGER + 1), () => rational('1.5'), () => rational(''),
    () => decimal('1e10000'), () => div(rational(1), rational(0))]) assert.throws(operation);
});
