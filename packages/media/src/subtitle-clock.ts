import type {Rational} from '../../core/src/time.ts';

/**
 * Select the already evaluated output frame's ASS event at one millisecond
 * inside its centisecond interval. libass converts timestamps to integer ms;
 * using 1/30 PTS directly can put frame111 at 3699.999...ms, selecting frame110.
 * A fixed +1ms relative to the original PTS is unsafe near 100fps, so lookup
 * uses the event's floor(frameTime*100) boundary instead. Text is <=100fps and
 * adjacent events therefore have distinct centisecond intervals.
 * After lookup restore integer frame PTS. Animation/property math is unchanged.
 * Exact raster inputs start at N=0 and supply their original global frame.
 */
export function subtitleClock(fps:Rational,frameOffset=0):{before:string;after:string}{
 const frame=frameOffset?`(N+${frameOffset})`:'N';
 return {before:`settb=expr=1/1000,setpts='floor(${frame}*${fps.denominator}*100/${fps.numerator})*10+1'`,after:`settb=expr=${fps.denominator}/${fps.numerator},setpts=${frame}`};
}
