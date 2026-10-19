import {COLOR_LUMINANCE,colorAdjustmentStages} from '../../core/src/color-effects.ts';
import type {ColorAdjustments} from '../../core/src/color-effects.ts';

export type GeqColorExpressions={r:string;g:string;b:string;a:string};
/**
 * geq input/output contract is 8-bit, full-range planar RGB plus alpha.
 * All intermediate arithmetic is normalized 0..1 and clamps after each stage.
 * It does not select a colour transfer function or claim native equivalence.
 */
export function colorEffectsGeqExpressions(value?:ColorAdjustments):GeqColorExpressions{
  const stages=colorAdjustmentStages(value),channels=['r','g','b'] as const;
  if(!stages.length)return {r:'r(X,Y)',g:'g(X,Y)',b:'b(X,Y)',a:'alpha(X,Y)'};
  const statements=channels.map((channel,i)=>`st(${i},${channel}(X,Y)/255)`);
  for(const stage of stages){
    if(stage.kind==='saturation'){
      statements.push(`st(3,${COLOR_LUMINANCE.map((weight,i)=>`${weight}*ld(${i})`).join('+')})`);
      for(let i=0;i<3;i++)statements.push(`st(${i},clip(ld(${i})*${stage.factor}+ld(3)*(${1-stage.factor}),0,1))`);
    }else for(let i=0;i<3;i++){
      const x=`ld(${i})`;
      let expression:string;
      if(stage.kind==='brightness')expression=`1-pow(1-${x}-(${stage.inputOffset}),${stage.exponent})`;
      else if(stage.kind==='contrast'){
        const p=stage.parameters;
        if(p.factor<=1)expression=`${p.factor}*(${x}-${p.pivot})+${p.pivot}`;
        else{
          statements.push(`st(3,1/(1+exp(-${p.xFactor}*(${x}-${p.pivot}))))`);
          statements.push(`st(4,${p.xFactor}*ld(3)*(1-ld(3)))`);
          statements.push(`st(5,if(lte(${x},${p.pivot}),pow((${p.pivotSlope}-ld(4))/${p.leftSlopeDiff},2)*(${p.leftDiff}),pow((${p.pivotSlope}-ld(4))/${p.rightSlopeDiff},2)*(${p.rightDiff})))`);
          expression=`ld(3)+${p.pivot}-.5+ld(5)`;
        }
      }
      else{
        const t=stage.kind==='highlight'?`(1-${x})`:x;
        const shaped=`(pow(${t},${stage.exponent})+(${stage.exponent-1})*(${t}*${t}-${t}*${t}*${t}))`;
        expression=stage.kind==='highlight'?`1-${shaped}`:shaped;
      }
      statements.push(`st(${i},clip(${expression},0,1))`);
    }
  }
  const prefix=statements.join(';');
  return {r:`${prefix};255*ld(0)`,g:`${prefix};255*ld(1)`,b:`${prefix};255*ld(2)`,a:'alpha(X,Y)'};
}
/** Returns a complete RGB filter fragment, or undefined for a neutral plan. */
export function colorEffectsGeq(value?:ColorAdjustments):string|undefined{
  if(!colorAdjustmentStages(value).length)return undefined;
  const e=colorEffectsGeqExpressions(value);
  return `format=gbrap,geq=r='${e.r}':g='${e.g}':b='${e.b}':a='${e.a}':interpolation=nearest`;
}
const glFloat=(v:number)=>{
  const text=String(Object.is(v,-0)?0:v);
  return text.includes('.')?text:text.includes('e')?text.replace('e','.0e'):`${text}.0`;
};
/**
 * Standalone GLSL ES function; caller owns sampling, alpha and colour space.
 * Generated from mathematical stage parameters, with no packaged shader code.
 */
export function colorEffectsShader(value?:ColorAdjustments,functionName='applyColorAdjustments'):string{
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)||functionName==='main'||functionName.startsWith('gl_'))throw Error('INVALID_COLOR_SHADER_NAME');
  const lines=[`vec3 ${functionName}(vec3 inputColor) {`,'  vec3 adjusted = inputColor;'];
  for(const stage of colorAdjustmentStages(value)){
    let expression:string;
    if(stage.kind==='saturation'){
      lines.push(`  float fxLuma = dot(adjusted,vec3(${COLOR_LUMINANCE.map(glFloat).join(',')}));`);
      expression=`adjusted*${glFloat(stage.factor)}+vec3(fxLuma*${glFloat(1-stage.factor)})`;
    }else if(stage.kind==='brightness'){
      expression=`vec3(1.0)-pow(vec3(1.0)-adjusted-vec3(${glFloat(stage.inputOffset)}),vec3(${glFloat(stage.exponent)}))`;
    }else if(stage.kind==='contrast'){
      const p=stage.parameters;
      if(p.factor<=1)expression=`${glFloat(p.factor)}*(adjusted-vec3(${glFloat(p.pivot)}))+vec3(${glFloat(p.pivot)})`;
      else{
        lines.push(`  vec3 fxContrastSigmoid = vec3(1.0)/(vec3(1.0)+exp(-${glFloat(p.xFactor)}*(adjusted-vec3(${glFloat(p.pivot)}))));`);
        lines.push(`  vec3 fxContrastSlope = ${glFloat(p.xFactor)}*fxContrastSigmoid*(vec3(1.0)-fxContrastSigmoid);`);
        lines.push(`  vec3 fxContrastLeft = step(adjusted,vec3(${glFloat(p.pivot)}));`);
        lines.push(`  vec3 fxContrastSlopeDiff = mix(vec3(${glFloat(p.rightSlopeDiff)}),vec3(${glFloat(p.leftSlopeDiff)}),fxContrastLeft);`);
        lines.push(`  vec3 fxContrastValueDiff = mix(vec3(${glFloat(p.rightDiff)}),vec3(${glFloat(p.leftDiff)}),fxContrastLeft);`);
        lines.push(`  vec3 fxContrastCorrection = (vec3(${glFloat(p.pivotSlope)})-fxContrastSlope)/fxContrastSlopeDiff;`);
        expression=`fxContrastSigmoid+vec3(${glFloat(p.pivot-.5)})+fxContrastCorrection*fxContrastCorrection*fxContrastValueDiff`;
      }
    }else{
      const local=stage.kind==='highlight'?'fxHighlightInput':'fxShadowInput';
      lines.push(`  vec3 ${local} = ${stage.kind==='highlight'?'vec3(1.0)-adjusted':'adjusted'};`);
      const shaped=`(pow(${local},vec3(${glFloat(stage.exponent)}))+${glFloat(stage.exponent-1)}*(${local}*${local}-${local}*${local}*${local}))`;
      expression=stage.kind==='highlight'?`vec3(1.0)-${shaped}`:shaped;
    }
    lines.push(`  adjusted = clamp(${expression},vec3(0.0),vec3(1.0));`);
  }
  return [...lines,'  return adjusted;','}'].join('\n');
}
