import { orderNotes } from './note-list.ts';
import { idxOf, isFileNote, isGlobalNote, keyIndex, rowKey, state } from './state.ts';

/**
 * Where a note is showing. The agent rewrites the code a note was written against, so the row it was
 * anchored to often stops existing part way through a conversation. A note is only put on a row
 * when the diff still provides an unambiguous subject:
 *
 *   `exact`    — its rows are still there, still holding the code it captured
 *   `moved`    — that code has one matching location elsewhere in the same file
 *   `outdated` — its code is gone or ambiguous: shown under the file, never on an unrelated line
 *   `null`     — the file itself left the diff: shown at the end of the page
 *
 * A note about the review as a whole was never anchored to anything, so it is `global` and stays
 * that way whatever the agent does to the code: it is shown in its own card above the first file.
 */
export type Placing = { fi: number; i: number; j: number; how: 'exact'|'moved'|'outdated'|'file'|'global' } | null;

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
  if(isGlobalNote(n)) return {fi:-1,i:-1,j:-1,how:'global'};
  const fi=idxOf(n.file);
  if(fi<0) return null;
  const f=state.files[fi];
  if(isFileNote(n)) return {fi,i:-1,j:-1,how:'file'};
  if(f.binary||!f.rows.length) return {fi,i:-1,j:-1,how:'outdated'};
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
/** Captured lines that still exist on this side of the diff, trimmed for comparison. Blank lines
 *  stay in place — the rows they must match are still there — but a run of nothing matches nothing. */
function captured(n: any,side: string,contextOnly: boolean){
  if(!n.code) return [];
  const lines=n.code.split('\n')
    .filter(l=>contextOnly?l[0]===' ':(side==='old'?l[0]!=='+':l[0]!=='-'))
    .map(l=>l.slice(1).trim());
  return lines.some(l=>l.length>0)?lines:[];
}

function relocate(f: any,fi: number,n: any): Placing{
  const side=n.side==='old'?'old':'new';
  const rows=sideRows(f,side);
  if(!rows.length) return {fi,i:-1,j:-1,how:'outdated'};
  // The code as captured first, then only its unchanged lines: an applied note has lost the rest.
  for(const want of [captured(n,side,false),captured(n,side,true)]){
    const hit=findRun(f,rows,want,side);
    if(hit==='ambiguous') return {fi,i:-1,j:-1,how:'outdated'};
    if(hit) return {fi,i:hit[0],j:hit[1],how:'moved'};
  }
  return {fi,i:-1,j:-1,how:'outdated'};
}

/** The only contiguous run reading exactly like `want`; two matches are not a credible anchor. */
function findRun(f: any,rows: number[],want: string[],side: string): [number,number]|'ambiguous'|null{
  if(!want.length) return null;
  let hit: [number,number]|null=null;
  for(let p=0;p+want.length<=rows.length;p++){
    const start=lineAt(f,rows[p] as number,side);
    let ok=start!=null;
    for(let q=0;q<want.length&&ok;q++){
      const k=rows[p+q] as number;
      if(f.rows[k].text.trim()!==want[q]) ok=false;
      // Adjacent in this list is not adjacent in the file across a hunk boundary: a run that jumps
      // the hidden lines between hunks would claim everything the diff left out as its own.
      else if(lineAt(f,k,side)!==(start as number)+q) ok=false;
    }
    if(!ok) continue;
    if(hit) return 'ambiguous';
    hit=[rows[p] as number,rows[p+want.length-1] as number];
  }
  return hit;
}


/** The review's own notes, in the order they were written. They belong to no file and never move. */
export const globalNotes=()=>[...state.notes.values()].filter((n: any)=>isGlobalNote(n));
/** Outdated notes in one file, kept under that file instead of attached to an unrelated row. */
export function outdatedNotes(fi: number){
  const f=state.files[fi];
  return [...state.notes.values()].filter((n: any)=>{
    const p=placeOf(n);
    return !!p&&p.how==='outdated'&&n.file===f.path;
  });
}
/**
 * Every note of this review, in the order the page reads them. Placement is the diff's business and
 * moves as the agent works, so the list is derived here rather than kept: the pane under the tree and
 * the all-notes panel both ask for it, and both get the order the diff itself is showing.
 */
export const orderedNotes=()=>orderNotes([...state.notes.values()],(n: any)=>placeOf(n));
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
