import { clip, rowKey } from './state.ts';

/* ---------- bookmarks: places in the diff worth coming back to ---------- */
/** One bookmark per row, so where it sits is its key: toggling reads it straight off the row. */
export const bmKey=(path: string,a: string)=>path+'|'+a;
/**
 * What a bookmark keeps: the same row anchor a note uses, so revealed context shifts it as safely,
 * plus enough of the line to recognise it in the list without the file being on screen.
 */
export function bookmarkOf(path: string,row: any){
  const a=rowKey(row);
  return {key:bmKey(path,a),file:path,a,side:row.n!=null?'new':'old',
    line:row.n!=null?row.n:row.o,text:clip(String(row.text||'').trim(),120)};
}
/**
 * The bookmarks a stored record hands back, or none. The record carries the read it was made in, so
 * a tab pointed at a different repository or range starts empty instead of inheriting marks that
 * name lines in someone else's files: every run serves from `localhost`, so the browser cannot tell
 * two projects apart by origin alone.
 */
export function bookmarksIn(record: any,scope: string){
  if(!record||record.scope!==scope||!Array.isArray(record.list)) return [];
  return record.list.filter((b: any)=>b&&b.key&&b.file&&b.a);
}
/** Sorts a bookmark the current diff cannot place to the end of the list, behind every live one. */
const LAST=Number.MAX_SAFE_INTEGER;
/**
 * Bookmarks in the order the diff shows them — file order, then row order — so stepping through them
 * walks the review top to bottom whatever order they were made in. `at` says where one sits; a
 * bookmark whose file or line is no longer in the diff reads as `gone` and sinks below the rest.
 */
export function orderBookmarks(list: any[],at: (b: any)=>{fi: number,i: number}){
  return list
    .map(b=>{
      // Either coordinate missing makes it gone, and gone sinks whole: a live file index would
      // otherwise leave it sorted among that file's live bookmarks instead of behind them all.
      const p=at(b), gone=p.fi<0||p.i<0;
      return {b,fi:gone?LAST:p.fi,i:gone?LAST:p.i,gone};
    })
    .sort((x,y)=>(x.fi-y.fi)||(x.i-y.i));
}
/** Where a step lands: from nowhere it enters at the near end, and from either end it wraps around,
 *  which is what makes two bookmarks a single key away from each other. */
export function stepAt(len: number,cur: number,dir: number){
  if(len<=0) return -1;
  if(cur<0||cur>=len) return dir>0?0:len-1;
  return (cur+dir+len)%len;
}
