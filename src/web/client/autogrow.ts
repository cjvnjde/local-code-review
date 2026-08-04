/* ---------- auto-growing textareas ---------- */
/** How tall a box should be for the text in it: never under the height it was designed at, never over
 *  the cap. Past the cap the box scrolls instead, so one long note cannot swallow the whole window. */
export function fitHeight(content: number,min: number,max: number){
  return Math.max(min,Math.min(content,max));
}
/** Grows `ta` with its content and returns the resizer, for callers that change the value themselves
 *  (typing fires `input`, assigning `.value` does not). Manual drag-resize is dropped: the next
 *  keystroke would overwrite it anyway. */
export function autogrow(ta: any,max: number){
  const cs=getComputedStyle(ta);
  // `box-sizing:border-box` is global here, but scrollHeight stops at the padding edge.
  const border=(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
  const min=parseFloat(cs.minHeight)||ta.offsetHeight||0;
  ta.style.resize='none';
  const fit=()=>{
    ta.style.height='auto'; // let it collapse first, or deleting lines could never shrink it
    const content=ta.scrollHeight+border;
    const h=fitHeight(content,min,max);
    ta.style.height=h+'px';
    ta.style.overflowY=content>h?'auto':'hidden';
  };
  ta.addEventListener('input',fit);
  fit();
  return fit;
}
/** Caps, in px. A note sits in the scrollable diff pane so it can afford to be tall; the overall note
 *  lives in the footer, where every pixel it takes comes off the diff. */
export const NOTE_MAX=320;
export const GENERAL_MAX=140;
