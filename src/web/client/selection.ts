import { setHidden, setViewed } from './diff-view.ts';
import { idxOf } from './load.ts';
import { openEditor } from './notes.ts';
import { save } from './persistence.ts';
import { SVG, el, state } from './state.ts';

/* ---------- selection ---------- */
const toggle=(set: Set<string>,key: string)=>set.has(key)?set.delete(key):set.add(key);
let drag: any=null;
export function paintSel(){
  el('diff').querySelectorAll('tr.sel').forEach(tr=>tr.classList.remove('sel'));
  const s=state.sel; if(!s) return;
  const [i,j]=[Math.min(s.a,s.b),Math.max(s.a,s.b)];
  for(let k=i;k<=j;k++){
    const tr=el('r'+s.fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.add('sel');
  }
}
export function clearSel(){ state.sel=null; paintSel(); }

const textSelected=()=>{
  const s=window.getSelection&&window.getSelection();
  return !!(s&&!s.isCollapsed&&String(s).trim());
};
el('diff').addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  // Pressing the gutter can only mean row selection; pressing code may still mean "select this text".
  if(e.target.closest('td.act,td.g')){ e.preventDefault(); document.body.classList.add('dragging'); }
  if(e.shiftKey&&state.sel&&state.sel.fi===fi) state.sel.b=i;
  else state.sel={fi,a:i,b:i};
  drag={fi,moved:false};
  paintSel();
});
// Hit-test the pointer: while a text drag is in flight the browser keeps sending events to the press target.
document.addEventListener('mousemove',e=>{
  if(!drag) return;
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const tr=under&&under.closest?under.closest('tr.r'):null;
  if(!tr||Number(tr.dataset.fi)!==drag.fi) return;
  const i=Number(tr.dataset.i);
  if(state.sel.b===i) return;
  state.sel.b=i; drag.moved=true;
  document.body.classList.add('dragging');
  const s=window.getSelection&&window.getSelection();
  if(s&&!s.isCollapsed) s.removeAllRanges();
  paintSel();
});
document.addEventListener('mouseup',()=>{
  if(!drag) return;
  const moved=drag.moved; drag=null;
  document.body.classList.remove('dragging');
  if(moved) openEditor();
});
el('diff').addEventListener('click',e=>{
  const fold=e.target.closest('[data-fold]');
  if(fold){
    const p=fold.dataset.fold;
    toggle(state.folded,p); save();
    const folded=state.folded.has(p), node=el('f'+idxOf(p));
    if(node) node.classList.toggle('fold',folded);
    fold.innerHTML=folded?SVG.chevR:SVG.chevD;
    fold.title=folded?'Expand file':'Collapse file';
    return;
  }
  const vw=e.target.closest('[data-vw]');
  if(vw){ setViewed([vw.dataset.vw],!state.viewed.has(vw.dataset.vw)); return; }
  const hf=e.target.closest('[data-hf]');
  if(hf){ setHidden([hf.dataset.hf],!state.hidden.has(hf.dataset.hf)); return; }
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  if(textSelected()){ clearSel(); return; }
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  if(!state.sel||state.sel.fi!==fi){ state.sel={fi,a:i,b:i}; paintSel(); }
  openEditor();
});
