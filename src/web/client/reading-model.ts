import { keyIndex, rowKey } from './state.ts';
import { cardAt } from './follow.ts';

export type ReadingPlace={path: string,hash: string,anchor: string,text: string,before?: string,after?: string,at: number,offset?: number};
export const settleDelay=(speed: number,limit: number)=>speed>(limit||1800)?2800:1200;
/** Cap elapsed time so a large first wheel/scrollbar movement after an idle read still counts as fast. */
export const scrollVelocity=(distance: number,elapsed: number)=>
  Math.abs(distance)/Math.max(1,Math.min(elapsed,250))*1000;

/** A changed diff must not silently move the marker onto unrelated code at the same line number. */
export function readingRow(file: any,place: ReadingPlace){
  if(!place.anchor) return -1;
  if(file.hash===place.hash){
    const at=keyIndex(file).get(place.anchor);
    if(at!=null&&file.rows[at].text===place.text) return at;
  }
  let matches=file.rows.map((row: any,i: number)=>({row,i}))
    .filter(({row}: any)=>row.t!=='hunk'&&row.text===place.text);
  if(matches.length>1) matches=matches.filter(({i}: any)=>
    (place.before!=null&&file.rows[i-1]?.text===place.before)||
    (place.after!=null&&file.rows[i+1]?.text===place.after));
  return matches.length===1?matches[0].i:-1;
}

export function readingPlace(file: any,index: number,offset?: number): ReadingPlace{
  const row=file.rows[index];
  return {path:file.path,hash:file.hash,anchor:row?rowKey(row):'',text:row?.text||'',
    before:file.rows[index-1]?.text,after:file.rows[index+1]?.text,at:Date.now(),offset};
}

/** Keep the remembered row below the sticky header, even after resizing to a shorter viewport. */
export function resumeOffset(offset: number|undefined,header: number,height: number){
  const wanted=Number.isFinite(offset)?offset!:header;
  return Math.max(header,Math.min(wanted,Math.max(header,height-header)));
}

/** Read geometry directly: the tree's active file can lag a scroll frame or end above a visible note. */
export function readingAt(pane: {top: number,bottom: number},cards: ArrayLike<any>,
  fileAt: (path: string)=>{fi: number,file: any}|null){
  let fallback=null;
  const start=cardAt(cards.length,i=>cards[i].getBoundingClientRect().top,pane.top);
  for(let i=Math.max(0,start);i<cards.length;i++){
    const card=cards[i];
    const rect=card.getBoundingClientRect();
    if(rect.bottom<=pane.top) continue;
    if(rect.top>=pane.bottom) break;
    const entry=fileAt(card.dataset.path); if(!entry) continue;
    if(!fallback) fallback={...entry,index:-1,offset:0};
    if(card.classList.contains('fold')) continue;
    const top=Math.max(pane.top,card.querySelector('.fh')?.getBoundingClientRect().bottom||pane.top);
    const row=[...card.querySelectorAll('tr.r')].find((row: any)=>{
      const r=row.getBoundingClientRect();
      return r.top>=top-1&&r.top<pane.bottom;
    }) as any;
    if(row) return {...entry,index:Number(row.dataset.i),offset:row.getBoundingClientRect().top-pane.top};
  }
  return fallback;
}
