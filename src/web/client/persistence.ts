import { bookmarksIn } from './bookmarks.ts';
import { compileHide } from './filters.ts';
import { GLOBAL_ANCHOR, el, idxOf, isMinted, mintGlobalId, mintNoteId, reindexNotes, state } from './state.ts';

/* ---------- persistence ---------- */
const CFG_KEY='gitreview:settings';
export function loadCfg(){
  try{ Object.assign(state.cfg,JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){}
  el('cfgAuto').checked=state.cfg.auto;
  el('cfgBack').checked=state.cfg.back;
  el('cfgToast').checked=state.cfg.toast;
  el('cfgLimit').value=String(state.cfg.limit);
  el('cfgExpand').value=String(state.cfg.expand);
  el('cfgHide').value=state.cfg.hide||'';
  el('cfgDeleted').checked=!!state.cfg.hideDeleted;
  el('cfgFoldDel').checked=!!state.cfg.foldDel;
  el('cfgEnter').checked=state.cfg.enterSaves;
  el('cfgSingle').checked=!!state.cfg.single;
  el('cfgGhosts').checked=state.cfg.ghosts!==false;
  el('cfgBack').disabled=!state.cfg.auto;
  state.hideRx=compileHide(state.cfg.hide);
}
/** Writes `state.cfg` out as it stands, for the preferences that are not fields in the settings panel. */
export function persistCfg(){
  try{ localStorage.setItem(CFG_KEY,JSON.stringify(state.cfg)); }catch(e){}
}
/** Returns true for the settings the rendered diff depends on: which files it shows, and its expanders. */
export function saveCfg(){
  state.cfg.auto=el('cfgAuto').checked;
  state.cfg.back=el('cfgBack').checked;
  state.cfg.toast=el('cfgToast').checked;
  state.cfg.limit=Number(el('cfgLimit').value);
  state.cfg.enterSaves=el('cfgEnter').checked;
  state.cfg.single=el('cfgSingle').checked;
  const hide=el('cfgHide').value, deleted=el('cfgDeleted').checked;
  const fold=el('cfgFoldDel').checked;
  const expand=Number(el('cfgExpand').value);
  const ghosts=el('cfgGhosts').checked;
  const changed=hide!==state.cfg.hide||deleted!==!!state.cfg.hideDeleted||
    fold!==!!state.cfg.foldDel||expand!==state.cfg.expand||ghosts!==(state.cfg.ghosts!==false);
  // Folding deletions changes how tall every block is, so no measured height survives the switch.
  if(fold!==!!state.cfg.foldDel) state.h.clear();
  state.cfg.foldDel=fold;
  state.cfg.ghosts=ghosts;
  state.cfg.hideDeleted=deleted;
  state.cfg.expand=expand;
  if(hide!==state.cfg.hide) state.hideRx=compileHide(hide);
  state.cfg.hide=hide;
  el('cfgBack').disabled=!state.cfg.auto;
  persistCfg();
  return changed;
}
/**
 * Which read this is: the repository as the server named it, and the diff being read in it. Every
 * run is served from `localhost` and a port one review frees the next one takes, so the origin alone
 * cannot tell two projects apart — without the repository in the key, every project on a machine
 * shares one record and reads back another project's notes.
 */
const scope=()=>state.repo+':'+state.range;
const store=()=>'gitreview:'+scope();
/** Said once per session: every save after a full store fails the same way, and one warning is news. */
let warnedStore=false;
function warnStore(){
  if(warnedStore) return;
  warnedStore=true;
  const host=el('toasts'); if(!host) return;
  const t=document.createElement('div');
  t.className='toast off';
  t.innerHTML='<span class="tx"></span><span class="lbl">not stored</span>';
  t.querySelector('.tx').textContent=
    'The browser refused to store this page’s notes — a reload may lose unsaved ones. Save the review to keep them.';
  host.append(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),200); },9000);
}
export function save(){
  reindexNotes();
  try{
    localStorage.setItem(store(),JSON.stringify({
      notes:[...state.notes.values()],
      hidden:[...state.hidden], shown:[...state.shown],
      collapsed:[...state.collapsed], folded:[...state.folded],
      viewed:[...state.viewed], delFold:[...state.delFold],
      // The review file owns the threads; this copy is only so a reload has them before it answers.
      msgs:[...state.msgs], seen:[...state.seen],
    }));
  }catch(e){
    warnStore(); // usually the quota: the page still works, but a reload would forget
  }
}
export function restore(){
  // Ahead of the notes, and not after them: a repository with nothing stored yet leaves early below,
  // and this tab may still be mid-read through it.
  restoreBookmarks();
  try{
    const d=JSON.parse(localStorage.getItem(store())||'null');
    if(!d) return;
    // The overall note used to be one field beside the notes rather than a note. What was typed into
    // it is still worth keeping, so it comes back as the first of the review's own notes.
    if((d.general||'').trim()){
      const id=mintGlobalId();
      state.notes.set(id,{id,file:'',body:d.general.trim(),a:GLOBAL_ANCHOR,b:GLOBAL_ANCHOR,
        scope:'global',start:0,end:0});
    }
    (d.notes||[]).forEach(n=>{
      // Ids used to be derived from the note's location, which made a note written where a handled one
      // had been indistinguishable from it. Notes stored that way are re-minted as the fresh, unsent
      // notes we cannot prove they are not; the cost is losing verdicts reported before this version.
      if(!isMinted(n.id)){ n.id=mintNoteId(n.file,n.a,n.b,n.ca,n.cb); n.sentAt=0; }
      state.notes.set(n.id,n);
    });
    state.hidden=new Set(d.hidden||[]);
    state.shown=new Set(d.shown||[]);
    state.collapsed=new Set(d.collapsed||[]);
    state.folded=new Set(d.folded||[]);
    // Which runs stand open is this read of the diff; which files fold theirs at all is a preference.
    state.delFold=new Map((d.delFold||[]).filter(e=>e&&typeof e[0]==='string').map(e=>[e[0],!!e[1]]));
    state.viewed=new Map((d.viewed||[]).map(e=>[e[0],typeof e[1]==='string'?{h:e[1],auto:false}:e[1]]));
    state.msgs=new Map((d.msgs||[]).filter(e=>e&&e[0]&&Array.isArray(e[1])));
    state.seen=new Map((d.seen||[]).filter(e=>e&&e[0]));
  }catch(e){}
}
/**
 * Bookmarks are the trail of one sitting, not a record of it: they say where the reader meant to
 * come back to before finishing, so they belong to the tab doing the reading and go when it closes.
 * That is what sessionStorage is — it survives the reload a live diff refresh or an F5 costs, and
 * nothing further. Notes are the opposite and stay in `store()`, which outlives the tab.
 */
const BM_KEY='gitreview:bookmarks';
export function saveBookmarks(){
  try{
    sessionStorage.setItem(BM_KEY,JSON.stringify({scope:scope(),list:[...state.bookmarks.values()]}));
  }catch(e){
    // Losing a place to jump back to costs a scroll, so it is not worth a warning of its own.
  }
}
export function restoreBookmarks(){
  let record=null;
  try{ record=JSON.parse(sessionStorage.getItem(BM_KEY)||'null'); }catch(e){}
  state.bookmarks=new Map(bookmarksIn(record,scope()).map((b: any)=>[b.key,b]));
  state.bmCur='';
}
/** Drops every bookmark and the record behind it, for the moments that end a read-through. */
export function clearBookmarks(){
  state.bookmarks.clear();
  state.bmCur='';
  saveBookmarks();
}
/** A file whose notes are gone was reviewed for feedback that no longer exists, so it needs another
 *  pass; a file nobody commented on keeps its mark, which pruneViewed drops if the file changed. */
export function unviewCommented(){
  // A note about the review as a whole names no file, so it puts none of them back either.
  const commented=new Set([...state.notes.values()].map((n: any)=>n.file).filter(Boolean));
  commented.forEach(p=>{ state.viewed.delete(p); state.folded.delete(p); });
  return commented;
}
/**
 * Takes notes out of the review file. The page reads that file back whole on every review event, so
 * a note only dropped here comes straight back with the next one — withdrawing is what makes
 * clearing stick. One request for the whole set: a delete per note announces the file after each
 * write, and the page would adopt the notes still in it back onto the page that just let them go.
 */
export function withdrawNotes(ids: string[]){
  const query=ids.map(id=>'id='+encodeURIComponent(id));
  if(!query.length) return Promise.resolve();
  // The page has already let them go; the file catches up, and a failed delete costs a stale entry.
  return fetch('/api/note?'+query.join('&'),{method:'DELETE'}).then(()=>{},()=>{});
}
/** Wipes the notes stored for this range, threads and all. Hidden and collapsed marks are not
 *  comments, so they stay. The review file itself is left on disk: it is the record of what was said,
 *  and withdrawing what this drops from the page is the caller's to do. */
export function clearNotes(){
  const unviewed=unviewCommented();
  state.notes.clear();
  state.msgs.clear();
  state.seen.clear();
  state.place.clear();
  save();
  return unviewed;
}
/** A viewed mark only holds while the file's diff is byte-identical to what was reviewed. */
export function pruneViewed(){
  const stale=[];
  state.viewed.forEach((v,p)=>{
    const i=idxOf(p);
    if(i<0||state.files[i].hash!==v.h) stale.push(p);
  });
  stale.forEach(p=>{ state.viewed.delete(p); state.folded.delete(p); });
  return stale;
}
