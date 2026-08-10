import { idxOf, isFileNote, keyIndex, rowKey, state } from './state.ts';

/**
 * Where a note is showing. The agent rewrites the code a note was written against, so the row it was
 * anchored to often stops existing part way through a conversation. A note is only ever cut loose
 * once there is nowhere honest left to put it:
 *
 *   `exact` — its rows are still there, still holding the code it captured
 *   `moved` — that code is now somewhere else in the same file
 *   `near`  — the code is gone, but the file still has a line close to where the note was written
 *   `loose` — the file is still in the diff, but nothing in it is close: shown under the file
 *   `null`  — the file itself left the diff: shown at the end of the page
 */
export type Placing = { fi: number; i: number; j: number; how: 'exact'|'moved'|'near'|'file'|'loose' } | null;

/** How far a note may be dragged from the line it was written on before that stops being "close by". */
const NEAR = 60;

export function placeNotes(){
  const map=new Map();
  state.notes.forEach((n: any)=>map.set(n.id,placeNote(n)));
  state.place=map;
}
/** Recomputes the notes in one file, after revealed context moved every row index below it. */
export function replaceIn(path: string){
  state.notes.forEach((n: any)=>{ if(n.file===path) state.place.set(n.id,placeNote(n)); });
}
export const placeOf=(n: any): Placing=>state.place.has(n.id)?state.place.get(n.id):placeNote(n);

export function placeNote(n: any): Placing{
  const fi=idxOf(n.file);
  if(fi<0) return null;
  const f=state.files[fi];
  if(isFileNote(n)) return {fi,i:-1,j:-1,how:'file'};
  if(f.binary||!f.rows.length) return {fi,i:-1,j:-1,how:'loose'};
  const ki=keyIndex(f);
  const i=ki.has(n.a)?ki.get(n.a):-1, j=ki.has(n.b)?ki.get(n.b):-1;
  if(i>=0&&j>=i&&holds(f,i,j,n)) return {fi,i,j,how:'exact'};
  return relocate(f,fi,n);
}

/** True while the rows under an anchor still read as the code the note captured. */
function holds(f: any,i: number,j: number,n: any){
  if(!n.code) return true;
  const want=n.code.split('\n');
  const rows=f.rows.slice(i,j+1).filter((r: any)=>r.t!=='hunk');
  if(rows.length!==want.length) return false;
  return rows.every((r: any,k: number)=>(want[k]||'').slice(1).trim()===r.text.trim());
}

/** Row indices a note of this side can sit on: the new side keeps additions, the old side deletions. */
function sideRows(f: any,side: string){
  const out=[];
  for(let k=0;k<f.rows.length;k++){
    const r=f.rows[k];
    if(r.t==='hunk') continue;
    if(side==='old'?r.o!=null:r.n!=null) out.push(k);
  }
  return out;
}
const lineAt=(f: any,k: number,side: string)=>side==='old'?f.rows[k].o:f.rows[k].n;
/** Captured lines that still exist on this side of the diff, trimmed for comparison. */
function captured(n: any,side: string,contextOnly: boolean){
  if(!n.code) return [];
  return n.code.split('\n')
    .filter(l=>contextOnly?l[0]===' ':(side==='old'?l[0]!=='+':l[0]!=='-'))
    .map(l=>l.slice(1).trim())
    .filter(l=>l.length>0);
}

function relocate(f: any,fi: number,n: any): Placing{
  const side=n.side==='old'?'old':'new';
  const rows=sideRows(f,side);
  if(!rows.length) return {fi,i:-1,j:-1,how:'loose'};
  // The code as captured first, then only its unchanged lines: an applied note has lost the rest.
  for(const want of [captured(n,side,false),captured(n,side,true)]){
    const hit=findRun(f,rows,want,n.start,side);
    if(hit) return {fi,i:hit[0],j:hit[1],how:'moved'};
  }
  const near=nearest(f,rows,n.start,side);
  return near>=0?{fi,i:near,j:near,how:'near'}:{fi,i:-1,j:-1,how:'loose'};
}

/** The run of rows reading exactly like `want`, preferring the one nearest where the note was written. */
function findRun(f: any,rows: number[],want: string[],from: number,side: string){
  if(!want.length) return null;
  let best=null, bestGap=Infinity;
  for(let p=0;p+want.length<=rows.length;p++){
    let ok=true;
    for(let q=0;q<want.length&&ok;q++){
      if(f.rows[rows[p+q] as number].text.trim()!==want[q]) ok=false;
    }
    if(!ok) continue;
    const gap=Math.abs((lineAt(f,rows[p] as number,side)||0)-from);
    if(gap<bestGap){ bestGap=gap; best=[rows[p] as number,rows[p+want.length-1] as number]; }
  }
  return best;
}

/** The row closest to the line the note was written on, while that is still close enough to mean it. */
function nearest(f: any,rows: number[],from: number,side: string){
  let best=-1, bestGap=Infinity;
  for(const k of rows){
    const gap=Math.abs((lineAt(f,k,side)||0)-from);
    if(gap<bestGap){ bestGap=gap; best=k; }
  }
  return bestGap<=NEAR?best:-1;
}

/** Notes with no place inside their file, in the order the diff shows those files. */
export function looseNotes(fi: number){
  const f=state.files[fi];
  return [...state.notes.values()].filter((n: any)=>{
    const p=placeOf(n);
    return !!p&&p.how==='loose'&&n.file===f.path;
  });
}
/** Notes whose file left the diff altogether. */
export function strayNotes(){
  return [...state.notes.values()].filter((n: any)=>placeOf(n)===null)
    .sort((a: any,b: any)=>a.file.localeCompare(b.file)||a.start-b.start);
}
/** The row a note is anchored to, or -1 when it is not on a row at all. */
export const rowOfNote=(n: any)=>{
  const p=placeOf(n);
  return p&&p.i>=0?p.j:-1;
};
export const anchorKeys=(f: any,i: number,j: number)=>[rowKey(f.rows[i]),rowKey(f.rows[j])];
