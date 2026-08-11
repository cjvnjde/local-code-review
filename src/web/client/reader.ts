import { orderedNotes } from './anchor.ts';
import { isHidden } from './filters.ts';
import { updateCount } from './footer.ts';
import { jumpToNote } from './live.ts';
import { FILTERS, groupNotes, matchesFilter } from './note-list.ts';
import { mountNoteIn } from './notes.ts';
import { save } from './persistence.ts';
import { el, esc, markRead, state, statusOf, unreadOf } from './state.ts';

/* ---------- all notes: the review read as a conversation instead of as marks on a diff ---------- */
/**
 * Reading a review back is a different job from making one. The diff answers "what does this line
 * say"; this answers "what have we said, and what came back". So it is the same notes, in the same
 * order, in the room they need to be legible: full width, each with the code it was written on, its
 * whole thread, and its reply box.
 *
 * It covers the diff rather than replacing it. That is the point — nothing is unmounted, so the diff
 * keeps its scroll position and its rows, and **in diff** on any note is one jump away from the code.
 * A note mounted here is a note box like any other, which is what keeps the two views in step: a
 * reply, a verdict, or an edit reaches every copy of a note through `repaintNote`.
 */

const CHIPS: Record<string,string>={all:'All',new:'New',open:'Open',done:'Done'};
/** Which filters one note answers to, asked of the two things a filter can be about. */
const match=(n: any,filter: string)=>{
  const st=statusOf(n);
  return matchesFilter(filter,unreadOf(n),st?st.status:null);
};
const visible=()=>orderedNotes().filter(e=>match(e.n,state.rdrFilter));

/**
 * What the panel is showing, so it is only rebuilt when that actually changed. Ids decide whether the
 * list itself moved; the rest of the signature is each note's placement, which changes under the
 * notes as the agent rewrites the code and has to be redrawn without throwing the list away.
 */
let shownIds: string|null=null, shownSig='';
const idsOf=(entries: any[])=>entries.map(e=>e.n.id).join(',');
const sigOf=(entries: any[])=>state.rdrFilter+'|'+
  entries.map(e=>e.n.id+':'+e.how+':'+e.fi+':'+e.i).join(',');

function headHtml(counts: Record<string,number>){
  return FILTERS.map(f=>'<button class="chip'+(f===state.rdrFilter?' on':'')+
    '" data-chip="'+f+'"'+(counts[f]||f==='all'?'':' disabled')+'>'+CHIPS[f]+
    '<span class="n">'+counts[f]+'</span></button>').join('');
}
/** The counts are of the whole review, not of what the current chip left standing. */
function paintHead(entries: any[]){
  const all=orderedNotes();
  const counts: Record<string,number>={};
  FILTERS.forEach(f=>{ counts[f]=0; });
  all.forEach(e=>FILTERS.forEach(f=>{ if(match(e.n,f)) counts[f]++; }));
  el('rdrCt').textContent=String(entries.length);
  el('rdrChips').innerHTML=headHtml(counts);
  el('rdrRead').disabled=!entries.some(e=>unreadOf(e.n)>0);
  const toggle=el('allNotes');
  toggle.textContent=state.reader?'Back to diff':'Read notes';
}

function groupHtml(g: any,count: number){
  const head='<div class="gh">'+
    (g.global?'<span class="p">Overall</span><span class="hid">about the review as a whole</span>'
      :g.stray?'<span class="p stray">Not in this diff any more</span>'
      :'<span class="p">'+esc(g.path)+'</span>')+
    '<span class="ct">'+count+(count===1?' note':' notes')+'</span>'+
    (!g.stray&&!g.global&&isHidden(g.path)?'<span class="hid">hidden in the diff</span>':'')+
    '</div>';
  return '<div class="rdrg">'+head+'<div class="gn"></div></div>';
}
/** Draws the list from scratch. Only ever called with no editor standing open inside the panel. */
function renderReader(){
  const entries=visible();
  const body=el('rdrbody');
  shownIds=idsOf(entries); shownSig=sigOf(entries);
  paintHead(entries);
  if(!entries.length){
    body.innerHTML='<div class="empty">'+(state.notes.size
      ?'No note matches this filter. Try <b>All</b>.'
      :'No notes yet. Click a line in the diff to write the first one.')+'</div>';
    return;
  }
  const groups=groupNotes(entries);
  body.innerHTML=groups.map(g=>groupHtml(g,g.entries.length)).join('');
  const hosts=body.querySelectorAll('.gn');
  groups.forEach((g,k)=>{
    const host=hosts[k];
    g.entries.forEach((e: any)=>{
      const wrap=document.createElement('div');
      wrap.className='rdrn'; wrap.dataset.nid=e.n.id;
      host.append(wrap);
      mountNoteIn(wrap,e.n);
    });
  });
}
/** Redraws one entry in place, for a note whose placement moved under it. A box being written in is
 *  left alone and the panel stays marked stale, exactly as the diff pane defers a refresh. */
function repaintEntry(wrap: any){
  if(wrap.querySelector('textarea')) return false;
  const n=state.notes.get(wrap.dataset.nid);
  if(!n) return false; // it has left the review; the next rebuild takes the wrapper with it
  wrap.textContent='';
  mountNoteIn(wrap,n);
  return true;
}
/**
 * Brings the panel back in line with the notes. Called wherever the footer's own count is updated, so
 * anything that changes a note reaches it; a rebuild that would eat an open editor is deferred rather
 * than taken, and `live.ts` retries it as soon as nothing is being written.
 */
export function syncReader(){
  if(!state.reader) return;
  const entries=visible();
  const ids=idsOf(entries), sig=sigOf(entries);
  if(ids===shownIds){
    paintHead(entries);
    if(sig===shownSig) return;
    const clean=[...el('rdrbody').querySelectorAll('.rdrn')].every(repaintEntry);
    if(clean) shownSig=sig;
    else state.rdrStale=true;
    return;
  }
  if(el('reader').querySelector('textarea')){ state.rdrStale=true; return; }
  state.rdrStale=false;
  renderReader();
}

export function openReader(){
  state.reader=true;
  el('reader').hidden=false;
  // Reopening keeps the panel where it was left, so only a list that actually moved is rebuilt.
  if(shownIds===null||shownIds!==idsOf(visible())) renderReader();
  else paintHead(visible());
}
/** Closes the panel, unless what is being written in it is worth more than the click. Says whether
 *  it went, because a jump to the diff that the reader called off must not happen behind it. */
export function closeReader(){
  if(!state.reader) return true;
  const ta: any=el('reader').querySelector('textarea');
  if(ta&&ta.value.trim()&&
    !confirm('Close the notes panel?\n\nWhat you are writing in it is lost.')) return false;
  state.reader=false;
  el('reader').hidden=true;
  paintHead(visible());
  return true;
}
export const toggleReader=()=>state.reader?closeReader():openReader();

el('rdrClose').onclick=()=>closeReader();
el('allNotes').onclick=()=>toggleReader();
/** Reading the replies is what makes them read; the sweep is here because nothing else counts them. */
el('rdrRead').onclick=()=>{
  const entries=visible();
  let changed=false;
  entries.forEach(e=>{ if(markRead(e.n)) changed=true; });
  if(!changed) return;
  save();
  el('rdrbody').querySelectorAll('.rdrn').forEach(repaintEntry);
  updateCount();
};
el('rdrChips').addEventListener('click',e=>{
  const chip=(e.target as any).closest('[data-chip]');
  if(!chip||chip.disabled) return;
  state.rdrFilter=chip.dataset.chip;
  renderReader();
  el('rdrbody').scrollTop=0; // a different set of notes is a different read, from the top
});
el('rdrbody').addEventListener('click',e=>{
  const t: any=e.target;
  const go=t.closest('[data-goto]');
  if(go){ jumpToNote(go.dataset.goto); return; }
  // A long capture is context for the note, not the note: it is folded until it is asked for.
  const cap=t.closest('.cap .caph');
  if(cap) cap.parentElement.classList.toggle('open');
});

/** Steps the panel entry by entry, the way the sidebar steps the diff. */
function stepEntry(dir: number){
  const body=el('rdrbody');
  const rows=[...body.querySelectorAll('.rdrn')];
  if(!rows.length) return;
  const top=body.getBoundingClientRect().top;
  const offs=rows.map(r=>r.getBoundingClientRect().top-top);
  let at=-1;
  if(dir>0) at=offs.findIndex(o=>o>4);
  else for(let k=offs.length-1;k>=0;k--){ if(offs[k]<-4){ at=k; break; } }
  if(at<0) at=dir>0?rows.length-1:0;
  rows[at].scrollIntoView({block:'start'});
}

document.addEventListener('keydown',e=>{
  const t: any=e.target;
  const typing=t&&(t.tagName==='TEXTAREA'||t.tagName==='INPUT'||t.isContentEditable);
  if(typing||e.metaKey||e.ctrlKey) return;
  // alt+c both ways, so the panel closes with the keys it opened with. `code`, because alt turns a
  // letter into another character entirely on macOS.
  if(e.altKey){
    if(e.code!=='KeyC') return;
    e.preventDefault(); toggleReader();
    return;
  }
  if(!state.reader) return;
  if(e.key==='Escape'){
    if(!el('settings').hidden) return; // the panel on top of it answers first
    e.preventDefault(); closeReader();
    return;
  }
  if(e.code==='KeyJ'||e.code==='KeyK'){ e.preventDefault(); stepEntry(e.code==='KeyJ'?1:-1); }
});
