import type {Transition} from '../../../packages/core/src/document.ts';

export const transitionPresentation:Record<Transition['kind'],{name:string;icon:string}>={
 crossfade:{name:'叠化',icon:'⋈'},
 dipToBlack:{name:'闪黑',icon:'◼'},
 dipToWhite:{name:'闪白',icon:'◻'},
 wipeLeft:{name:'向左擦除',icon:'◧'},
 circleOpen:{name:'圆形遮罩',icon:'◉'},
};
