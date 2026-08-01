import { renderDiff } from './diff-view.ts';
import { pruneViewed, restore, save } from './persistence.ts';
import { el, esc, state } from './state.ts';
import { renderTree } from './tree.ts';
import { updateCount } from './footer.ts';

/* ---------- load ---------- */
export async function load(){
  const r=await fetch('/api/diff');
  const d=await r.json();
  if(!r.ok||d.error){
    el('diff').innerHTML='<div class="empty">git could not produce this diff:<br><br>'+esc(d.error||'unknown error')+
      '<br><br>Restart the server with different arguments.</div>';
    return;
  }
  state.files=d.files; state.range=d.range;
  state.byPath=new Map(d.files.map((f,i)=>[f.path,i]));
  state.h.clear(); state.tree=null;
  el('range').textContent=d.range;
  if(!state.loaded){ restore(); state.loaded=true; }
  state.stale=new Set(pruneViewed());
  save();
  render();
}
export const idxOf=(path: string)=>state.byPath.has(path)?state.byPath.get(path):-1;

export function render(){ renderTree(); renderDiff(); updateCount(); }
