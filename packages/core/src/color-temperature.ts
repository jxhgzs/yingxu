/**
 * Independent temperature/tint equations, integrated into the editor in 0.7. Static equations and numeric colourimetry data are documented in
 * docs/qa/2026-10-19-rea-temperature.md. Limited native colour-card comparison
 * is recorded separately; this is not a claim of complete runtime parity.
 * RGB remains in the caller's current encoding, with no implicit gamma change.
 */
export type TemperatureRgb=readonly [number,number,number];
export type TemperatureMatrix=readonly [TemperatureRgb,TemperatureRgb,TemperatureRgb];

// Reciprocal megakelvin, CIE 1960 u/v, and isotherm slope. These are numeric
// colourimetry observations, not target program/shader source.
const LOCUS:readonly (readonly [number,number,number,number])[]=[
  [0,.18006,.26352,-.24341],[10,.18066,.26589,-.25479],
  [20,.18133,.26846,-.26876],[30,.18208,.27119,-.28539],
  [40,.18293,.27407,-.30470],[50,.18388,.27709,-.32675],
  [60,.18494,.28021,-.35156],[70,.18611,.28342,-.37915],
  [80,.18740,.28668,-.40955],[90,.18880,.28997,-.44278],
  [100,.19032,.29326,-.47888],[125,.19462,.30141,-.58204],
  [150,.19962,.30921,-.70471],[175,.20525,.31647,-.84901],
  [200,.21142,.32312,-1.0182],[225,.21807,.32909,-1.2168],
  [250,.22511,.33439,-1.4512],[275,.23247,.33904,-1.7298],
  [300,.24010,.34308,-2.0637],[325,.24792,.34655,-2.4681],
  [350,.25591,.34951,-2.9641],[375,.26400,.35200,-3.5814],
  [400,.27218,.35407,-4.3633],[425,.28039,.35577,-5.3762],
  [450,.28863,.35714,-6.7262],[475,.29685,.35823,-8.5955],
  [500,.30505,.35907,-11.324],[525,.31320,.35968,-15.628],
  [550,.32129,.36011,-23.325],[575,.32931,.36038,-40.770],
  [600,.33724,.36051,-116.45],
];
const XYZ_TO_CONE:TemperatureMatrix=[
  [.8951,.2664,-.1614],[-.7502,1.7135,.0367],[.0389,-.0685,1.0296],
];
// Deliberately retain the observed rounded inverse. Computing an exact inverse
// changes the non-neutral branch and conceals its small discontinuity at zero.
const CONE_TO_XYZ:TemperatureMatrix=[
  [.987,-.1471,.16],[.4323,.5184,.0493],[-.0085,.04,.9685],
];
const RGB_TO_XYZ:TemperatureMatrix=[
  [.4123907992659595,.357584339383878,.1804807884018343],
  [.21263900587151036,.715168678767756,.07219231536073371],
  [.019330818715591832,.11919477979462598,.9505321522496607],
];
const XYZ_TO_RGB:TemperatureMatrix=[
  [3.2409699419045213,-1.5373831775700935,-.4986107602930033],
  [-.9692436362808796,1.8759675015077208,.04155505740717562],
  [.05563007969699364,-.20397695888897655,1.0569715142428784],
];
const IDENTITY=():TemperatureMatrix=>[[1,0,0],[0,1,0],[0,0,1]];
const dot=(a:TemperatureRgb,b:TemperatureRgb)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const transform=(matrix:TemperatureMatrix,rgb:TemperatureRgb):[number,number,number]=>[
  dot(matrix[0],rgb),dot(matrix[1],rgb),dot(matrix[2],rgb),
];
function multiply(a:TemperatureMatrix,b:TemperatureMatrix):TemperatureMatrix{
  const columns:TemperatureMatrix=[[b[0][0],b[1][0],b[2][0]],[b[0][1],b[1][1],b[2][1]],[b[0][2],b[1][2],b[2][2]]];
  return a.map(row=>columns.map(column=>dot(row,column))) as unknown as TemperatureMatrix;
}
function intensity(value:number):void{
  if(typeof value!=='number'||!Number.isFinite(value)||value< -1||value>1)throw Error('INVALID_COLOR_TEMPERATURE_INTENSITY');
}
const clip=(value:number,low=0,high=1)=>Math.min(high,Math.max(low,value));

/** UI-normalized temperature amount; positive amounts lower the whitepoint K. */
export function temperatureKelvin(amount:number):number{
  intensity(amount);
  return 6500-1970*amount+876*amount*amount-2630*amount*amount*amount;
}

/** Whitepoint in XYZ, normalized to Y=1. Tint follows the isotherm direction. */
export function temperatureTintWhitepoint(temperature:number,tint:number):TemperatureRgb{
  const reciprocal=1e6/temperatureKelvin(temperature);intensity(tint);
  // The supported normalized domain is strictly within the table. Select the
  // first row above the target reciprocal temperature, including exact knots.
  const upper=LOCUS.findIndex(row=>row[0]>reciprocal);
  if(upper<1)throw Error('COLOR_TEMPERATURE_LOCUS_OUT_OF_RANGE');
  const lower=LOCUS[upper-1],higher=LOCUS[upper];
  const weight=(reciprocal-lower[0])/(higher[0]-lower[0]);
  const interpolate=(a:number,b:number)=>a+(b-a)*weight;
  let u=interpolate(lower[1],higher[1]),v=interpolate(lower[2],higher[2]);
  const lowLength=Math.sqrt(1+lower[3]*lower[3]),highLength=Math.sqrt(1+higher[3]*higher[3]);
  const directionU=interpolate(1/lowLength,1/highLength);
  const directionV=interpolate(lower[3]/lowLength,higher[3]/highLength);
  const length=Math.sqrt(directionU*directionU+directionV*directionV);
  u+=tint*.01*directionU/length;v+=tint*.01*directionV/length;
  const denominator=2+u-4*v;
  let x=clip(1.5*u/denominator,1e-6,.999999),y=clip(v/denominator,1e-6,.999999);
  // This branch is retained as an observation, not corrected to a textbook
  // chromaticity normalization. It is unreachable in the accepted [-1,1] grid.
  if(x+y>.999999){const divisor=.999999/(x+y);x/=divisor;y/=divisor;}
  return [x/y,1,(1-x-y)/y];
}

/** Row-major matrix; exact neutral deliberately bypasses rounded adaptation. */
export function temperatureTintMatrix(temperature:number,tint:number):TemperatureMatrix{
  intensity(temperature);intensity(tint);
  if(temperature===0&&tint===0)return IDENTITY();
  const target=transform(XYZ_TO_CONE,temperatureTintWhitepoint(temperature,tint));
  const base=transform(XYZ_TO_CONE,temperatureTintWhitepoint(0,0));
  const gain:TemperatureMatrix=[[target[0]/base[0],0,0],[0,target[1]/base[1],0],[0,0,target[2]/base[2]]];
  return multiply(XYZ_TO_RGB,multiply(multiply(CONE_TO_XYZ,multiply(gain,XYZ_TO_CONE)),RGB_TO_XYZ));
}

/** Clamps after the entire RGB matrix operation, never between its factors. */
export function applyTemperatureTint(rgb:TemperatureRgb,temperature:number,tint:number):[number,number,number]{
  if(!Array.isArray(rgb)||rgb.length!==3||rgb.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0||value>1))throw Error('INVALID_COLOR_TEMPERATURE_RGB');
  const matrix=temperatureTintMatrix(temperature,tint);
  if(temperature===0&&tint===0)return [rgb[0],rgb[1],rgb[2]];
  return transform(matrix,rgb).map(value=>clip(value)) as [number,number,number];
}
