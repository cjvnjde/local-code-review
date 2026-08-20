import { plainShots } from './attach.ts';
import { plainRefs } from './note-ref.ts';
import { bodyParts } from './suggest.ts';

/* ---------- the notes of one review, read as a list rather than as marks on a diff ---------- */
/**
 * Both the pane under the tree and the all-notes panel show the same notes in the same order, so the
 * ordering, the grouping, and what a filter chip means live here rather than in either of them. It is
 * all pure: where a note sits is handed in, because that is the diff's business and it changes under
 * the notes as the agent works.
 */

/** A note the diff can no longer place sorts behind every note it can still put somewhere. */
const LAST=Number.MAX_SAFE_INTEGER;

/** Where a note is showing, as `anchor.ts` reports it; null once its file left the diff. */
export type NoteAt = { fi: number; i: number; how: string } | null;
export interface NoteEntry { n: any; fi: number; rank: number; i: number; how: string; gone: boolean }

/**
 * Notes in the order the page shows them, which is the order the review reads in: down the diff by
 * file, and inside a file by the row each note sits on. A file's own note comes before the lines it
 * covers, and one the file can no longer place comes after all of them — the same three positions the
 * diff pane puts them in, so neither view ever tells a different story than the other.
 */
export function orderNotes(list: any[],at: (n: any)=>NoteAt): NoteEntry[]{
  return list.map((n: any)=>{
    const p=at(n);
    // About the review rather than about a place in it, so it reads before the first file.
    if(p&&p.how==='global') return {n,fi:-1,rank:0,i:-1,how:'global',gone:false};
    // No file left to sit under: it reads last, in the block at the end of the page.
    if(!p||p.fi<0) return {n,fi:LAST,rank:1,i:LAST,how:'stray',gone:true};
    const rank=p.how==='file'?0:p.how==='loose'?2:1;
    return {n,fi:p.fi,rank,i:rank===1?p.i:(rank===0?-1:LAST),how:p.how,gone:false};
  }).sort((x,y)=>(x.fi-y.fi)||(x.rank-y.rank)||(x.i-y.i)||
    String(x.n.file).localeCompare(String(y.n.file))||(x.n.start||0)-(y.n.start||0));
}

export interface NoteGroup { key: string; path: string; fi: number; stray: boolean; global: boolean; entries: NoteEntry[] }
/**
 * The list cut into the file headings it reads under. Notes about the review as a whole share the
 * group at the top, and notes with nowhere left to go share one at the end, whatever files they were
 * written on, because that is the one thing left to say about them.
 */
export function groupNotes(entries: NoteEntry[]): NoteGroup[]{
  const out: NoteGroup[]=[];
  entries.forEach(e=>{
    const key=e.how==='global'?'\0overall':e.gone?'\0stray':String(e.n.file);
    const last=out[out.length-1];
    if(last&&last.key===key){ last.entries.push(e); return; }
    const away=e.how==='global'||e.gone;
    out.push({key,path:away?'':String(e.n.file),fi:away?-1:e.fi,stray:e.gone,
      global:e.how==='global',entries:[e]});
  });
  return out;
}

/** The filters the panel offers, in the order its chips read. */
export const FILTERS=['all','new','open','done'] as const;
export type NoteFilter = typeof FILTERS[number];
/** Verdicts that finish a note. Everything else — pending, needs-input, an unknown kind, or no
 *  verdict at all — is still open, so a status kind added later needs no change here. */
const DONE=new Set(['applied','answered','skipped']);
export function matchesFilter(filter: string,unread: number,status: string|null){
  if(filter==='new') return unread>0;
  if(filter==='open') return !status||!DONE.has(status);
  if(filter==='done') return !!status&&DONE.has(status);
  return true;
}

/**
 * One line of a note, for the places that have room for one line. The prose is what identifies a
 * note; a note that is only a proposed replacement says so instead of showing a line of its code,
 * which would read as the file rather than as the remark. A reference to another note reads here as
 * the note it names, and an attached picture as what it was called, because a line of text has no
 * room to be a link or a picture.
 */
export function noteSummary(body: string){
  const parts=bodyParts(body||'');
  const text=parts.find(p=>p.t==='text');
  if(text){
    const line=text.v.split('\n').map(l=>l.trim()).find(l=>l.length>0);
    if(line) return plainRefs(plainShots(line));
  }
  return parts.some(p=>p.t==='sug')?'suggested change':'';
}
