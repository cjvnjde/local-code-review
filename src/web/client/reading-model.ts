import { keyIndex, rowKey } from './state.ts';

export type ReadingPlace={path: string,hash: string,anchor: string,text: string,before?: string,after?: string,at: number};
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

export function readingPlace(file: any,index: number): ReadingPlace{
  const row=file.rows[index];
  return {path:file.path,hash:file.hash,anchor:row?rowKey(row):'',text:row?.text||'',
    before:file.rows[index-1]?.text,after:file.rows[index+1]?.text,at:Date.now()};
}
