import { repaintRow, setHidden, setViewed } from './diff-view.ts';
import { leftRow } from './drag.ts';
import { isHidden } from './filters.ts';
import { openEditor, openFileEditor } from './notes.ts';
import { save } from './persistence.ts';
import { SVG, el, idxOf, state } from './state.ts';

/* ---------- selection ---------- */
const toggle=(set: Set<string>,key: string)=>set.has(key)?set.delete(key):set.add(key);
let drag: any=null;
/** Row whose code cell currently carries the character highlight, so it can be cleaned up. */
let charRow: any=null;
export function paintSel(){
  el('diff').querySelectorAll('tr.sel').forEach(tr=>tr.classList.remove('sel'));
  const s=state.sel;
  const next=s&&s.ca!=null?{fi:s.fi,i:s.a}:null;
  const prev=charRow; charRow=next;
  if(prev&&(!next||prev.fi!==next.fi||prev.i!==next.i)) repaintRow(prev.fi,prev.i);
  if(next) repaintRow(next.fi,next.i);
  if(!s||s.ca!=null) return; // a character range highlights characters, not the whole row
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
const cellOf=(node: any)=>{
  const e=node&&(node.nodeType===1?node:node.parentElement);
  return e&&e.closest?e.closest('td.c'):null;
};
/** Character offset of a DOM position, measured in the row text the cell was rendered from. */
function codeOffset(td: any,node: any,offset: number){
  const r=document.createRange();
  r.setStart(td,0);
  try{ r.setEnd(node,offset); }catch(e){ return null; }
  return r.toString().length;
}
/** An edge of the selection, measured in the anchor cell; one that slipped out of it clamps to a line edge. */
function edgeOffset(td: any,node: any,offset: number,len: number){
  if(cellOf(node)===td) return codeOffset(td,node,offset);
  const e=node&&(node.nodeType===1?node:node.parentElement);
  if(!e) return null;
  return (td.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)?len:0;
}
/** A text selection anchored in one code cell notes those characters only. */
function charSel(anchor?: any){
  const sel=window.getSelection&&window.getSelection();
  if(!sel||sel.isCollapsed||sel.rangeCount!==1) return null;
  const r=sel.getRangeAt(0);
  const td=anchor||cellOf(r.startContainer);
  if(!td) return null;
  const tr=td.closest('tr.r'); if(!tr) return null;
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  const f=state.files[fi]; if(!f||!f.rows[i]) return null;
  const text=f.rows[i].text;
  let a=edgeOffset(td,r.startContainer,r.startOffset,text.length);
  let b=edgeOffset(td,r.endContainer,r.endOffset,text.length);
  if(a==null||b==null) return null;
  if(b<a){ const t=a; a=b; b=t; }
  a=Math.max(0,Math.min(a,text.length)); b=Math.max(0,Math.min(b,text.length));
  if(!text.slice(a,b).trim()) return null;  // whitespace only: nothing to talk about
  if(a===0&&b===text.length) return null;   // the whole line is a plain line note
  return {fi,a:i,b:i,ca:a,cb:b};
}
el('diff').addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  // Pressing the gutter can only mean row selection; pressing code may still mean "select this text".
  const cell=e.target.closest('td.c');
  if(!cell){ e.preventDefault(); document.body.classList.add('dragging'); }
  if(e.shiftKey&&state.sel&&state.sel.fi===fi) state.sel={fi,a:state.sel.a,b:i};
  else state.sel={fi,a:i,b:i};
  drag={fi,i,moved:false,cell};
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
  // Brushing the next row mid-sentence is a slip, not a range: a text drag must clear the pressed row first.
  if(drag.cell&&!drag.moved){
    const from=el('r'+drag.fi+'-'+drag.i);
    if(from){
      const {top,bottom}=from.getBoundingClientRect();
      if(!leftRow(e.clientY,top,bottom)) return;
    }
  }
  state.sel.b=i; state.sel.ca=null; drag.moved=true;
  document.body.classList.add('dragging');
  const s=window.getSelection&&window.getSelection();
  if(s&&!s.isCollapsed) s.removeAllRanges();
  paintSel();
});
document.addEventListener('mouseup',()=>{
  if(!drag) return;
  const {moved,cell}=drag; drag=null;
  document.body.classList.remove('dragging');
  if(moved){ openEditor(); return; }
  if(!cell) return;
  const cs=charSel(cell);
  if(!cs) return;
  // The painted range replaces the browser highlight, which the repaint below would drop anyway.
  const sel=window.getSelection&&window.getSelection();
  if(sel) sel.removeAllRanges();
  state.sel=cs; paintSel(); openEditor();
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
  if(hf){ setHidden([hf.dataset.hf],!isHidden(hf.dataset.hf)); return; }
  const cf=e.target.closest('[data-cf]');
  if(cf){ clearSel(); openFileEditor(idxOf(cf.dataset.cf)); return; }
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  if(state.sel&&state.sel.ca!=null) return; // mouseup already opened the editor for this range
  if(textSelected()){ clearSel(); return; }
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  if(!state.sel||state.sel.fi!==fi){ state.sel={fi,a:i,b:i}; paintSel(); }
  openEditor();
});
