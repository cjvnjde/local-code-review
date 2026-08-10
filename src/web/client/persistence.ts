import { compileHide } from './filters.ts';
import { el, idxOf, isMinted, mintNoteId, reindexNotes, saveKeyHint, state } from './state.ts';

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
  el('cfgEnter').checked=state.cfg.enterSaves;
  el('cfgSingle').checked=!!state.cfg.single;
  el('cfgBack').disabled=!state.cfg.auto;
  el('saveKey').textContent=saveKeyHint();
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
  const expand=Number(el('cfgExpand').value);
  const changed=hide!==state.cfg.hide||deleted!==!!state.cfg.hideDeleted||expand!==state.cfg.expand;
  state.cfg.hideDeleted=deleted;
  state.cfg.expand=expand;
  if(hide!==state.cfg.hide) state.hideRx=compileHide(hide);
  state.cfg.hide=hide;
  el('cfgBack').disabled=!state.cfg.auto;
  el('saveKey').textContent=saveKeyHint();
  persistCfg();
  return changed;
}
const store=()=>'gitreview:'+state.range;
export function save(){
  reindexNotes();
  try{
    localStorage.setItem(store(),JSON.stringify({
      general:el('general').value,
      notes:[...state.notes.values()],
      hidden:[...state.hidden], shown:[...state.shown],
      collapsed:[...state.collapsed], folded:[...state.folded],
      viewed:[...state.viewed], bookmarks:[...state.bookmarks.values()],
      // The review file owns the threads; this copy is only so a reload has them before it answers.
      msgs:[...state.msgs], seen:[...state.seen],
    }));
  }catch(e){}
}
export function restore(){
  try{
    const d=JSON.parse(localStorage.getItem(store())||'null');
    if(!d) return;
    el('general').value=d.general||'';
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
    state.viewed=new Map((d.viewed||[]).map(e=>[e[0],typeof e[1]==='string'?{h:e[1],auto:false}:e[1]]));
    state.bookmarks=new Map((d.bookmarks||[]).filter(b=>b&&b.key).map(b=>[b.key,b]));
    state.msgs=new Map((d.msgs||[]).filter(e=>e&&e[0]&&Array.isArray(e[1])));
    state.seen=new Map((d.seen||[]).filter(e=>e&&e[0]));
  }catch(e){}
}
/** A file whose notes are gone was reviewed for feedback that no longer exists, so it needs another
 *  pass; a file nobody commented on keeps its mark, which pruneViewed drops if the file changed. */
export function unviewCommented(){
  const commented=new Set([...state.notes.values()].map((n: any)=>n.file));
  commented.forEach(p=>{ state.viewed.delete(p); state.folded.delete(p); });
  return commented;
}
/** Wipes the notes stored for this range, threads and all. Hidden and collapsed marks are not
 *  comments, so they stay. The review file itself is left on disk: it is the record of what was said. */
export function clearNotes(){
  const unviewed=unviewCommented();
  state.notes.clear();
  state.msgs.clear();
  state.seen.clear();
  state.place.clear();
  el('general').value='';
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
