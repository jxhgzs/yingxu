/**
 * Independent scalar interpretation of the contrast-v3 / combined-adjust
 * mathematical candidate documented in docs/qa/rea-effects-next.md.
 * Static resource agreement is not proof of native runtime or pixel agreement.
 * Inputs and outputs use normalized RGB channel values; no colour conversion
 * occurs here. The combined-adjust stage enable epsilon belongs to its caller.
 */
export const CONTRAST_PIVOT=.435;
export type ContrastParameters={
  readonly factor:number;
  readonly pivot:number;
  readonly xFactor:number;
  readonly leftDiff:number;
  readonly rightDiff:number;
  readonly leftSlopeDiff:number;
  readonly rightSlopeDiff:number;
  readonly pivotSlope:number;
};

function validateIntensity(intensity:number):void{
  if(typeof intensity!=='number'||!Number.isFinite(intensity)||intensity< -1||intensity>1)throw Error('INVALID_COLOR_CONTRAST_INTENSITY');
}

/** The negative and positive UI halves have different gain mappings. */
export function contrastFactor(intensity:number):number{
  validateIntensity(intensity);
  return 1+(intensity<=0?.4:.6)*intensity;
}

/** Shared scalar constants for independent CPU, LUT and GPU implementations. */
export function contrastParameters(intensity:number):ContrastParameters{
  const factor=contrastFactor(intensity),pivot=CONTRAST_PIVOT;
  const xFactor=Math.exp(8.33*factor-12.16)+5.82*factor-1.72;
  const sigmoid=(x:number)=>1/(1+Math.exp(-xFactor*(x-pivot)));
  const leftSigmoid=sigmoid(0),rightSigmoid=sigmoid(1);
  const pivotSlope=xFactor/4;
  return {
    factor,pivot,xFactor,pivotSlope,
    leftDiff:.5-pivot-leftSigmoid,
    rightDiff:1.5-pivot-rightSigmoid,
    leftSlopeDiff:pivotSlope-xFactor*leftSigmoid*(1-leftSigmoid),
    rightSlopeDiff:pivotSlope-xFactor*rightSigmoid*(1-rightSigmoid),
  };
}

/**
 * Evaluate a single normalized channel. JS calculations use double precision;
 * consumers using float32 uniforms/arithmetic must validate their own tolerance.
 */
export function applyContrastChannel(input:number,intensity:number):number{
  if(typeof input!=='number'||!Number.isFinite(input)||input<0||input>1)throw Error('INVALID_COLOR_CHANNEL');
  const factor=contrastFactor(intensity);
  // Also covers nonzero subnormal intensities whose gain rounds to one.
  if(factor===1)return input;
  const clamp=(x:number)=>Math.min(1,Math.max(0,x));
  if(factor<1)return clamp(factor*(input-CONTRAST_PIVOT)+CONTRAST_PIVOT);
  // The positive mathematical curve fixes both endpoints exactly.
  if(input===0||input===1)return input;
  const p=contrastParameters(intensity);
  const sigmoid=1/(1+Math.exp(-p.xFactor*(input-p.pivot)));
  const slope=p.xFactor*sigmoid*(1-sigmoid);
  const left=input<=p.pivot;
  const correction=(p.pivotSlope-slope)/(left?p.leftSlopeDiff:p.rightSlopeDiff);
  return clamp(sigmoid+p.pivot-.5+correction*correction*(left?p.leftDiff:p.rightDiff));
}
