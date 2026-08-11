import { placeNotes } from './anchor.ts';
import { renderBookmarks } from './bookmark-pane.ts';
import { renderDiff } from './diff-view.ts';
import { updateCount } from './footer.ts';
import { markTails } from './gaps.ts';
import { pruneViewed, restore, save } from './persistence.ts';
import { el, esc, idxOf, isMinted, reviewTime, state } from './state.ts';
import { renderTree } from './tree.ts';

/* ---------- load ---------- */
/**
 * One reload at a time: two in flight would race, and whichever git run resolved last would win
 * whether or not its snapshot was the newer one. A request that lands mid-load runs after it.
 */
let loading=false, queued=false;
export async function load(keep=false){
  if(loading){ queued=true; return; }
  loading=true;
  try{ await loadNow(keep); }
  finally{
    loading=false;
    if(queued){ queued=false; await load(true); }
  }
}
async function loadNow(keep: boolean){
  const mark=keep?scrollMark():null;
  const [diff,review]=await Promise.all([
    fetch('/api/diff').then(r=>r.json().then(d=>({ok:r.ok,d}))),
    fetch('/api/review').then(r=>r.json().then(d=>({ok:r.ok,d}))).catch(()=>({ok:false,d:{}})),
  ]);
  const d=diff.d;
  if(!diff.ok||d.error){
    el('diff').innerHTML='<div class="empty">git could not produce this diff:<br><br>'+esc(d.error||'unknown error')+
      '<br><br>Restart the server with different arguments.</div>';
    return;
  }
  state.files=d.files; state.repo=d.repo||''; state.range=d.range;
  markTails(d.files,Number(d.context));
  state.byPath=new Map(d.files.map((f,i)=>[f.path,i]));
  // Oldest review file first, so a newer verdict on the same note replaces an older one.
  state.status=new Map(); state.statusByKey=new Map();
  (d.statuses||[]).forEach(s=>{
    if(s.id) state.status.set(s.id,s);
    if(s.key) state.statusByKey.set(s.key,s);
  });
  state.h.clear(); state.tree=null;
  el('range').textContent=d.range;
  if(!state.loaded){ restore(); state.loaded=true; }
  if(review.ok) adopt(review.d);
  state.stale=new Set(pruneViewed());
  save();
  placeNotes();
  render();
  if(mark) scrollTo(mark);
}

/**
 * Takes the conversation back from the review file. The file is the one writer of threads, and it
 * also outlives this page: a note it holds that the browser has forgotten — a restarted server
 * picking the file back up, or a second tab — is adopted rather than dropped, so the reviewer sees
 * the whole conversation whichever side of it they come from.
 */
export function adopt(review: any){
  state.sessionFile=review.file||'';
  const at=reviewTime(review.file||'')||Date.now();
  const held=new Set();
  (review.notes||[]).forEach((n: any)=>{
    if(!n.id) return;
    held.add(n.id);
    state.msgs.set(n.id,n.messages||[]);
    const kept=state.notes.get(n.id);
    if(kept){ if(!kept.sentAt) kept.sentAt=at; return; }
    const note=noteFrom(n,at);
    if(note) state.notes.set(n.id,note);
  });
  // A thread whose note left the file went with it; keeping it would haunt the next note on that id.
  [...state.msgs.keys()].forEach((id: any)=>{ if(!held.has(id)) state.msgs.delete(id); });
}

/** Anchors are carried in the note's own id, which is what makes a review file readable back. */
function anchorsFrom(id: string){
  const parts=String(id).split('|');
  return parts.length>=3&&parts[1]&&parts[2]?[parts[1],parts[2]]:null;
}
function noteFrom(n: any,at: number){
  if(!isMinted(n.id)) return null; // an id we cannot prove was minted here cannot be matched back
  const anchors=anchorsFrom(n.id); if(!anchors) return null;
  const note: any={id:n.id,file:n.file||'',body:n.body||'',a:anchors[0],b:anchors[1],
    side:n.side==='old'?'old':'new',start:n.start||0,end:n.end||0,sentAt:at};
  if(n.scope==='file'||n.scope==='global'){ note.scope=n.scope; note.start=0; note.end=0; }
  else note.label=n.label||'';
  if(n.code) note.code=n.code;
  if(n.ca!=null){ note.ca=n.ca; note.cb=n.cb; }
  if(n.snippet) note.snippet=n.snippet;
  return note;
}

/** Where the pane is reading, so a live refresh puts it back instead of jumping to the top. */
function scrollMark(){
  const sec=el('diff'), node=el('f'+idxOf(state.active));
  if(!node) return null;
  return {path:state.active,dy:node.getBoundingClientRect().top-sec.getBoundingClientRect().top};
}
function scrollTo(mark: any){
  const sec=el('diff'), node=el('f'+idxOf(mark.path));
  if(!node) return;
  sec.scrollTop+=node.getBoundingClientRect().top-sec.getBoundingClientRect().top-mark.dy;
}

export function render(){ renderTree(); renderDiff(); renderBookmarks(); updateCount(); }
