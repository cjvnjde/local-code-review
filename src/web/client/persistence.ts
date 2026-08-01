import { idxOf } from './load.ts';
import { el, noteId, state } from './state.ts';

/* ---------- persistence ---------- */
const CFG_KEY='gitreview:settings';
export function loadCfg(){
  try{ Object.assign(state.cfg,JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){}
  el('cfgAuto').checked=state.cfg.auto;
  el('cfgBack').checked=state.cfg.back;
  el('cfgToast').checked=state.cfg.toast;
  el('cfgLimit').value=String(state.cfg.limit);
  el('cfgBack').disabled=!state.cfg.auto;
}
export function saveCfg(){
  state.cfg.auto=el('cfgAuto').checked;
  state.cfg.back=el('cfgBack').checked;
  state.cfg.toast=el('cfgToast').checked;
  state.cfg.limit=Number(el('cfgLimit').value);
  el('cfgBack').disabled=!state.cfg.auto;
  try{ localStorage.setItem(CFG_KEY,JSON.stringify(state.cfg)); }catch(e){}
}
const store=()=>'gitreview:'+state.range;
export function save(){
  try{
    localStorage.setItem(store(),JSON.stringify({
      general:el('general').value,
      notes:[...state.notes.values()],
      hidden:[...state.hidden], collapsed:[...state.collapsed], folded:[...state.folded],
      viewed:[...state.viewed],
    }));
  }catch(e){}
}
export function restore(){
  try{
    const d=JSON.parse(localStorage.getItem(store())||'null');
    if(!d) return;
    el('general').value=d.general||'';
    (d.notes||[]).forEach(n=>{ n.id=noteId(n.file,n.a,n.b); state.notes.set(n.id,n); });
    state.hidden=new Set(d.hidden||[]);
    state.collapsed=new Set(d.collapsed||[]);
    state.folded=new Set(d.folded||[]);
    state.viewed=new Map((d.viewed||[]).map(e=>[e[0],typeof e[1]==='string'?{h:e[1],auto:false}:e[1]]));
  }catch(e){}
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
