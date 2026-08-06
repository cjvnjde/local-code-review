/* ---------- drag intent ---------- */
/** Vertical slack a text drag may wander outside the pressed row before it counts as leaving it.
 *  Stays above half a code row (--row in styles.css), so a wobble cannot cross it. */
export const ROW_SLIP=14;
/** True once the pointer sits far enough past the pressed row that selecting rows is the obvious intent. */
export const leftRow=(y: number,top: number,bottom: number,slip=ROW_SLIP)=>y>bottom+slip||y<top-slip;
/** Slack around the press point that still reads as the pointer being back where the drag began. */
export const START_SLIP=12;
/**
 * True while the pointer rests where the drag started. A drag that wandered onto other rows and came
 * back here collected its fragment by accident, so the pressed line as a whole is what was meant.
 */
export const atStart=(x: number,y: number,x0: number,y0: number,slip=START_SLIP)=>
  Math.abs(x-x0)<=slip&&Math.abs(y-y0)<=slip;
/**
 * The character range a pair of offsets notes inside a line, or null when nothing narrower than the
 * line is covered: an empty run, a blank run, and the full line are all plain line notes.
 */
export function charRange(text: string,a: number,b: number){
  const i=Math.max(0,Math.min(a,b)), j=Math.min(text.length,Math.max(a,b));
  if(j<=i) return null;
  if(!text.slice(i,j).trim()) return null;
  if(i===0&&j===text.length) return null;
  return {a:i,b:j};
}
