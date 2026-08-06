/* ---------- following the diff: which file the pane is on, and where the tree has to scroll ---------- */
/** Clear space kept above and below the followed row, so the files around it stay readable. */
export const LEAD=44;
/**
 * Index of the card the top of the pane sits in: the last one starting at or above that line.
 * Cards are laid out in order and never overlap, so their tops only rise and a binary search reads
 * a handful of them per frame rather than all of them. Above the first card that card still counts,
 * because it is the one being scrolled into.
 */
export function cardAt(count: number,topOf: (i: number)=>number,line: number){
  let lo=0, hi=count-1, hit=-1;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    if(topOf(mid)<=line){ hit=mid; lo=mid+1; }
    else hi=mid-1;
  }
  return count?Math.max(hit,0):-1;
}
/**
 * Scroll delta that pulls a row inside its pane, keeping the lead margin; 0 when it already is there.
 * The margin shrinks for a pane too short to hold the row plus both leads, or the two edges would
 * pull against each other and the row would never settle.
 */
export function revealShift(paneTop: number,paneBottom: number,rowTop: number,rowBottom: number,lead=LEAD){
  const pad=Math.min(lead,Math.max(0,(paneBottom-paneTop-(rowBottom-rowTop))/2));
  if(rowTop<paneTop+pad) return rowTop-paneTop-pad;
  if(rowBottom>paneBottom-pad) return rowBottom-paneBottom+pad;
  return 0;
}
