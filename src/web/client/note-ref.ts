import { isFileNote, isGlobalNote, noteKey } from './state.ts';

/* ---------- one note pointing at another ---------- */
/**
 * A review talks about itself. "Same reason as over here" is a sentence a reviewer writes, and it is
 * only worth writing if the reader can follow it, so a note may name another note of the same review
 * and the page shows the referenced note and its replies beside that prose.
 *
 * The reference travels in the note's own prose as `#<ref>` (older `[<heading>](lcr:<ref>)` links
 * still work), because the review file is read by the agent as well as by the page.
 * `<ref>` is the tail of that note's id, which
 * is what the `<!-- lcr:... -->` marker on that heading ends with. Nothing else is written down.
 * Where the note it names is now, and whether it is still in the review at all, are re-read every
 * time the prose is drawn, exactly as the note's own place on the diff is.
 */

/** Scheme the destination carries, so a reference cannot be mistaken for a link to a file. */
export const REF_SCHEME='lcr:';
/** The unique tail `mintNoteId` ends every id with, which is what a reference names a note by. */
export const refOf=(id: unknown)=>(/\|#([0-9a-z]+)$/.exec(String(id==null?'':id))||[])[1]||'';
/** The reference a link destination carries, or empty when it is an ordinary link. */
export function refIn(url: string){
  const raw=String(url||'').replace(/^<|>$/g,'').trim();
  if(/^lcr:[0-9a-z]+$/i.test(raw)) return raw.slice(REF_SCHEME.length);
  if(/^#[0-9a-z]+$/.test(raw)) return raw.slice(1);
  if(/^#note=[0-9a-z]+$/.test(raw)) return raw.slice(6);
  try{
    const url=new URL(raw);
    if(/^https?:$/.test(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)
      &&url.pathname==='/'&&/^#note=[0-9a-z]+$/.test(url.hash)) return url.hash.slice(6);
  }catch{}
  return '';
}
/**
 * The one note a reference names. A tail is minted from the clock and a counter, so two of them can
 * only ever be equal by an accident this cannot rule out; a reference several notes answer to
 * therefore names none of them, and reads as a reference to a note that is not here rather than as a
 * confident pointer at the wrong one.
 */
export function noteByRef(ref: string,notes: Iterable<any>){
  if(!ref) return null;
  let found: any=null;
  for(const n of notes){
    if(refOf(n&&n.id)!==ref) continue;
    if(found) return null;
    found=n;
  }
  return found;
}
/** What a reference reads as in prose: beside the note it stands in, the file's own name is enough. */
export const refLabel=(n: any)=>isGlobalNote(n)?noteKey(n)
  :String(n.file).split('/').pop()+(isFileNote(n)?' (whole file)':':'+(n.label||n.start||''));
/** A stable short token survives reordering, deletion and restarting without renumbering notes. */
export const refToken=(n: any)=>'#'+refOf(n.id);
export const refLink=(n: any,base: string)=>new URL('/#note='+refOf(n.id),base).href;
/**
 * A reference written in at the caret, one space clear of the words around it, and where the caret
 * lands after it: the sentence carries on behind the chip rather than in front of it. Pure, because
 * the box it goes into is the editor's business and this is the part worth being sure of.
 */
export function insertRef(text: string,from: number,to: number,token: string){
  const value=String(text||'');
  const cut=Math.max(0,Math.min(from,value.length));
  const end=Math.max(cut,Math.min(to,value.length));
  const head=value.slice(0,cut), tail=value.slice(end);
  const lead=head&&!/\s$/.test(head)?' ':'';
  const trail=tail&&!/^[\s.,;:!?)\]]/.test(tail)?' ':'';
  return {value:head+lead+token+trail+tail,caret:head.length+lead.length+token.length};
}
/** The same link, as the parser reads it back. */
const LINK=/\[((?:[^[\]\\]|\\.)*)\]\([ \t]*<?lcr:([0-9a-z]*)>?[ \t]*\)/gi;
/**
 * A body with its references read as the words they are, for the places that show a line of a note
 * as text rather than as Markdown: a one-line summary has no room to be a link, and the heading the
 * reference carries is what it was saying anyway.
 */
export const plainRefs=(text: string)=>
  String(text||'').replace(LINK,(_,label)=>String(label).replace(/\\(.)/g,'$1'));
