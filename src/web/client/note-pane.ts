import { orderedNotes } from './anchor.ts';
import { stepAt } from './bookmarks.ts';
import { isHidden } from './filters.ts';
import { jumpToNote } from './live.ts';
import { noteSummary } from './note-list.ts';
import { openReader } from './reader.ts';
import { SVG, clip, el, esc, isFileNote, isGlobalNote, state, statusOf, unreadOf } from './state.ts';

/* ---------- note list: every remark this review has made, as an index into the diff ---------- */
/**
 * The pane is the way around a review that has grown past one screen. It is an index and nothing
 * more: a note is read, edited, answered, and deleted in its own box, whether that box is standing in
 * the diff or in the all-notes panel. What this offers is the one thing neither of those can — the
 * whole review at a glance, and a step from any note to the next.
 */

/** How a note names itself in a list one line wide: the file's own name is enough next to the tree. */
const rowLabel=(n: any)=>isGlobalNote(n)?'Overall'
  :String(n.file).split('/').pop()+(isFileNote(n)?' — whole file':':'+(n.label||n.start||''));
/** The same, spelled out for the row's tooltip. */
const rowTitle=(n: any)=>isGlobalNote(n)?'About the review as a whole'
  :n.file+(isFileNote(n)?' (whole file)':':'+(n.label||n.start||''));
/** Why a note is not where it was written, for the row's tooltip. */
const PLACED: Record<string,string>={
  moved:'the code it was written on has moved',
  outdated:'its code is gone or ambiguous; kept under its original file',
  stray:'its file is not in this diff any more',
};

/** The pane only exists while the review has said something, so an empty list takes no room. */
export function renderNotePane(){
  const list=orderedNotes();
  el('ntpane').hidden=!list.length;
  el('ntct').textContent=String(list.length);
  el('ntAll').disabled=!list.length;
  el('ntlist').innerHTML=list.map(e=>{
    const n=e.n, st=statusOf(n), unread=unreadOf(n), hid=!!n.file&&isHidden(n.file);
    const why=PLACED[e.how]||'';
    return '<div class="nw'+(e.gone?' gone':'')+(n.id===state.ntCur?' cur':'')+
      '" data-nt-go="'+esc(n.id)+'" title="'+esc(rowTitle(n)+
        (st?' — '+st.status.replace('-',' '):'')+(why?' — '+why:'')+(hid?' — this file is hidden':''))+'">'+
      '<span class="ni"><span class="loc">'+esc(rowLabel(n))+'</span>'+
      '<span class="tx">'+esc(clip(noteSummary(n.body),64)||'—')+'</span></span>'+
      '<span class="nb">'+
        (unread?'<span class="unread">'+unread+'</span>':'')+
        (st?'<span class="dot '+esc(st.status)+'"></span>':'')+
      '</span></div>';
  }).join('');
}

/** Goes to one note, and remembers it as the place stepping carries on from. */
function goTo(id: string){
  state.ntCur=id;
  renderNotePane();
  jumpToNote(id);
}
/** Walks the review note by note, from wherever it was left, wrapping at both ends. */
export function stepNote(dir: number){
  const list=orderedNotes();
  if(!list.length) return;
  const cur=list.findIndex(e=>e.n.id===state.ntCur);
  const at=stepAt(list.length,cur,dir); // the stepper the bookmark list walks with
  if(at>=0) goTo(list[at].n.id);
}
/** Marks a note as the one being read, for a jump that started somewhere other than this pane. */
export function markCurrentNote(id: string){
  if(state.ntCur===id) return;
  state.ntCur=id;
  renderNotePane();
}

el('ntPrev').innerHTML=SVG.expUp;
el('ntNext').innerHTML=SVG.expDown;
el('ntPrev').onclick=()=>stepNote(-1);
el('ntNext').onclick=()=>stepNote(1);
el('ntAll').onclick=()=>openReader();
el('ntlist').addEventListener('click',e=>{
  const go=(e.target as any).closest('[data-nt-go]');
  if(go) goTo(go.dataset.ntGo);
});
/**
 * Stepping without the mouse. Alt keeps it clear of typing, and the arrows are the bookmark list's,
 * so notes step on the letters instead; `code` rather than `key`, because alt turns a letter into
 * something else entirely on macOS.
 */
document.addEventListener('keydown',e=>{
  if(!e.altKey||e.metaKey||e.ctrlKey) return;
  if(e.code!=='KeyJ'&&e.code!=='KeyK') return;
  const t: any=e.target;
  if(t&&(t.tagName==='TEXTAREA'||t.tagName==='INPUT'||t.isContentEditable)) return;
  if(!state.notes.size) return;
  e.preventDefault();
  stepNote(e.code==='KeyJ'?1:-1);
});
