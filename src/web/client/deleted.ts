import { placeOf } from './anchor.ts';
import { rowKey, state } from './state.ts';

/* ---------- folded deletions: the diff read as the file it is about to be ---------- */
/**
 * A change that rewrites a lot of code reads as two files interleaved, and the one the reviewer has
 * to live with is the harder of the two to see. Folding the removed lines away leaves exactly the new
 * side — additions and the context around them — with every run of deletions one click from coming
 * back. Nothing about the diff changes, only how much of it is drawn: the rows are still in the file,
 * so notes, bookmarks and anchors all keep reading the same diff they always did.
 *
 * A fold is keyed by the old-side line its run starts on rather than by a row index, so revealing
 * context above it does not shuffle which runs are open. Runs are cut at block boundaries, because a
 * block is the unit that gets drawn and a fold spanning two of them would have each draw its own half
 * of the label. Which runs are open lives in this page only, exactly as revealed context does: the
 * setting is the preference, and the runs you opened are this read.
 */

export const foldingDeleted=()=>!!state.cfg.foldDel;
/** A run's identity: its file, and the line the first row of it takes away. */
export const delKey=(f: any,i: number)=>f.path+'|'+rowKey(f.rows[i]);

export interface DelRun{ start: number; end: number; count: number; key: string; open: boolean; noted: boolean }

/**
 * Row spans the notes of one file are showing on. A run holding one is never folded away: a note that
 * quietly stopped being drawn is a note the reviewer would never know to look for.
 */
function notedSpans(f: any){
  const spans: number[][]=[];
  state.notes.forEach((n: any)=>{
    if(n.file!==f.path) return;
    const p=placeOf(n);
    if(p&&p.i>=0) spans.push([p.i,p.j]);
  });
  return spans;
}

/**
 * The runs of removed rows inside `[from,to)`, by the row each of them starts on. Only the starting
 * row is listed: that is the row the marker is drawn on, and the rest of the run follows from `end`.
 */
export function delRuns(f: any,from: number,to: number){
  const out=new Map<number,DelRun>();
  if(!foldingDeleted()||f.binary) return out;
  const spans=notedSpans(f);
  for(let k=from;k<to;k++){
    if(f.rows[k].t!=='del') continue;
    let end=k;
    while(end+1<to&&f.rows[end+1].t==='del') end++;
    const key=delKey(f,k);
    const noted=spans.some(s=>s[0]<=end&&s[1]>=k);
    out.set(k,{start:k,end,count:end-k+1,key,noted,open:noted||state.openDel.has(key)});
    k=end;
  }
  return out;
}
/** The one run covering a row, as its block draws it, or null when nothing is folded over it. */
export function delRunAt(f: any,i: number,from: number,to: number){
  const runs=delRuns(f,from,to);
  for(const run of runs.values()) if(run.start<=i&&i<=run.end) return run;
  return null;
}
/**
 * Rows a block draws once its folds are taken out: what a placeholder has to stand in for. Every run
 * costs its marker row, and a folded one gives back the rows the marker is standing in for.
 */
export function drawnRows(f: any,from: number,to: number){
  let n=to-from;
  delRuns(f,from,to).forEach(run=>{ n+=run.open?1:1-run.count; });
  return n;
}
/**
 * Opens the fold over one row, and says whether that changed anything. A jump has to be able to land:
 * a bookmark or a note on a removed line is reached by opening the run that put it away, exactly as
 * a jump un-hides a file and expands a fold to get to a line.
 */
export function revealRow(f: any,i: number,from: number,to: number){
  const run=delRunAt(f,i,from,to);
  if(!run||run.open) return false;
  state.openDel.add(run.key);
  return true;
}
/** Flips the fold over one run and says whether it now stands open. */
export function toggleRun(f: any,i: number){
  const key=delKey(f,i);
  if(state.openDel.has(key)){ state.openDel.delete(key); return false; }
  state.openDel.add(key);
  return true;
}
