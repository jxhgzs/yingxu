export type Rational = {numerator: string; denominator: string};
type Integer = string | bigint | number;

function integer(v: Integer): bigint {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw Error('INVALID_INTEGER');
  if (typeof v === 'string' && (!/^-?\d+$/.test(v) || v.length > 4096)) throw Error('INVALID_INTEGER');
  return BigInt(v);
}
export function rational(n: Integer, d: Integer = 1): Rational {
  let a = integer(n), b = integer(d);
  if (b === 0n) throw Error('ZERO_DENOMINATOR');
  if (b < 0n) { a = -a; b = -b; }
  let x = a < 0n ? -a : a, y = b;
  while (y) { const next = x % y; x = y; y = next; }
  return {numerator: String(a / x), denominator: String(b / x)};
}
export function decimal(text: string): Rational {
  if (typeof text !== 'string' || text.length > 4096) throw Error('INVALID_DECIMAL');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) throw Error('INVALID_DECIMAL');
  const exp = Number(m[4] || 0) - (m[3]?.length || 0);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000) throw Error('DECIMAL_LIMIT');
  const n = BigInt((m[1] === '-' ? '-' : '') + m[2] + (m[3] || ''));
  return exp >= 0 ? rational(n * 10n ** BigInt(exp)) : rational(n, 10n ** BigInt(-exp));
}
export const micros = (v: number) => rational(integer(v), 1000000n);
export function add(a: Rational, b: Rational): Rational {
  return rational(BigInt(a.numerator) * BigInt(b.denominator) +
    BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
}
export const sub = (a: Rational, b: Rational) => add(a, rational(-BigInt(b.numerator), b.denominator));
export const mul = (a: Rational, b: Rational) =>
  rational(BigInt(a.numerator) * BigInt(b.numerator), BigInt(a.denominator) * BigInt(b.denominator));
export const div = (a: Rational, b: Rational) =>
  rational(BigInt(a.numerator) * BigInt(b.denominator), BigInt(a.denominator) * BigInt(b.numerator));
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const n = BigInt(sub(a, b).numerator);
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}
/** Floating conversion is for UI and media boundaries, never accumulated editing time. */
export const toNumber = (a: Rational) => Number(a.numerator) / Number(a.denominator);
export const frameTime = (frame: Integer, fps: Rational) => div(rational(frame), fps);
export function nearestFrame(time: Rational, fps: Rational): Rational {
  const frames = mul(time, fps), n = BigInt(frames.numerator), d = BigInt(frames.denominator);
  return rational(n < 0n ? -((-n * 2n + d) / (2n * d)) : (n * 2n + d) / (2n * d));
}
export const ZERO = rational(0);
