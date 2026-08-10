import { toggleBookmark } from './bookmark-pane.ts';
import { repaintRow, setFolded, setHidden, setViewed } from './diff-view.ts';
import { atStart, charRange, leftRow } from './drag.ts';
import { expandGap } from './expand.ts';
import { isHidden } from './filters.ts';
import { openEditor, openFileEditor } from './notes.ts';
import { el, idxOf, state } from './state.ts';

/* ---------- selection ---------- */
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
const sameSel=(a: any,b: any)=>!!a&&!!b&&a.fi===b.fi&&a.a===b.a&&a.b===b.b&&
  (a.ca==null?b.ca==null:a.ca===b.ca)&&(a.cb==null?b.cb==null:a.cb===b.cb);

const textSelected=()=>{
  const s=window.getSelection&&window.getSelection();
  return !!(s&&!s.isCollapsed&&String(s).trim());
};
/** The browser highlight is only ever a step towards a painted range, so it is dropped once read. */
const dropTextSel=()=>{
  const s=window.getSelection&&window.getSelection();
  if(s&&!s.isCollapsed) s.removeAllRanges();
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
  const a=edgeOffset(td,r.startContainer,r.startOffset,text.length);
  const b=edgeOffset(td,r.endContainer,r.endOffset,text.length);
  if(a==null||b==null) return null;
  const ch=charRange(text,a,b);
  return ch?{fi,a:i,b:i,ca:ch.a,cb:ch.b}:null;
}
/** Character offset the pointer rests on, measured in the row text the cell was rendered from. */
function offsetAt(td: any,x: number,y: number,len: number){
  const d: any=document;
  const p=d.caretPositionFromPoint?d.caretPositionFromPoint(x,y):null;
  if(p) return edgeOffset(td,p.offsetNode,p.offset,len);
  const r=d.caretRangeFromPoint?d.caretRangeFromPoint(x,y):null;
  if(r) return edgeOffset(td,r.startContainer,r.startOffset,len);
  return null;
}
/**
 * The fragment a wandering drag has collected on the row it started in: press point to pointer,
 * or null once the pointer is back on the press point and the whole line is the obvious intent.
 */
function pointRange(d: any,x: number,y: number){
  // Pressing the gutter, or extending an existing range with shift, only ever means whole rows.
  if(!d.cell||d.off0==null||d.a!==d.i) return null;
  const f=state.files[d.fi], row=f&&f.rows[d.i];
  if(!row) return null;
  if(atStart(x,y,d.x0,d.y0)) return null;
  const off=offsetAt(d.cell,x,y,row.text.length);
  return off==null?null:charRange(row.text,d.off0,off);
}
el('diff').addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  const tr=e.target.closest('tr.r');
  // The bookmark flag is not a way into a note, so it takes no selection with it.
  if(!tr||e.target.closest('.nbox')||e.target.closest('[data-bm]')) return;
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  // Pressing the gutter can only mean row selection; pressing code may still mean "select this text".
  const cell=e.target.closest('td.c');
  if(!cell){ e.preventDefault(); document.body.classList.add('dragging'); }
  const extended=!!(e.shiftKey&&state.sel&&state.sel.fi===fi);
  if(extended) state.sel={fi,a:state.sel.a,b:i};
  else state.sel={fi,a:i,b:i};
  const f=state.files[fi], row=f&&f.rows[i];
  // Taken now rather than on the way back: a wheel scroll mid-drag moves the press point out from under x0,y0.
  const off0=cell&&row?offsetAt(cell,e.clientX,e.clientY,row.text.length):null;
  drag={fi,i,a:state.sel.a,cell,off0,extended,x0:e.clientX,y0:e.clientY,rows:false,wandered:false,away:false};
  paintSel();
});
// Hit-test the pointer: while a text drag is in flight the browser keeps sending events to the press target.
document.addEventListener('mousemove',e=>{
  if(!drag) return;
  if(!atStart(e.clientX,e.clientY,drag.x0,drag.y0)) drag.away=true;
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const tr=under&&under.closest?under.closest('tr.r'):null;
  if(!tr||Number(tr.dataset.fi)!==drag.fi) return;
  const i=Number(tr.dataset.i);
  if(i!==drag.i){
    // Brushing the next row mid-sentence is a slip, not a range: a text drag must clear the pressed row first.
    if(drag.cell&&!drag.rows){
      const from=el('r'+drag.fi+'-'+drag.i);
      if(from){
        const {top,bottom}=from.getBoundingClientRect();
        if(!leftRow(e.clientY,top,bottom)) return;
      }
    }
    drag.rows=drag.wandered=true;
    document.body.classList.add('dragging');
    dropTextSel();
    const range={fi:drag.fi,a:drag.a,b:i};
    if(sameSel(state.sel,range)) return;
    state.sel=range;
    paintSel();
    return;
  }
  // Back on the pressed row. Once the drag has been away the browser highlight is gone for good,
  // so the fragment is measured from the pointer instead, and collapses to the line at the press point.
  if(!drag.wandered) return;
  drag.rows=false;
  if(drag.cell) document.body.classList.remove('dragging'); // a gutter drag keeps its row cursor
  dropTextSel();
  const ch=pointRange(drag,e.clientX,e.clientY);
  const next: any={fi:drag.fi,a:drag.a,b:drag.i};
  if(ch){ next.ca=ch.a; next.cb=ch.b; }
  if(sameSel(state.sel,next)) return;
  state.sel=next; paintSel();
});
document.addEventListener('mouseup',e=>{
  if(!drag) return;
  const {wandered,away,cell,extended,x0,y0}=drag; drag=null;
  document.body.classList.remove('dragging');
  // A drag that left the pressed row already holds its own answer: rows, a measured fragment,
  // or the plain line it came back to. The browser highlight plays no part in it.
  if(wandered){ dropTextSel(); openEditor(); return; }
  // A shift-click extends by whole rows even on a code cell: the highlight the browser stretched
  // from the last click is a side effect of the shift, not a fragment picked on this row.
  if(extended){ dropTextSel(); openEditor(); return; }
  if(!cell) return;
  // Released where it began after travelling: the text it brushed on the way was not the point.
  if(away&&atStart(e.clientX,e.clientY,x0,y0)){ dropTextSel(); openEditor(); return; }
  const cs=charSel(cell);
  if(!cs) return;
  // The painted range replaces the browser highlight, which the repaint below would drop anyway.
  dropTextSel();
  state.sel=cs; paintSel(); openEditor();
});
el('diff').addEventListener('click',e=>{
  const xp=e.target.closest('[data-exp]');
  if(xp){ void expandGap(Number(xp.dataset.fi),Number(xp.dataset.i),xp.dataset.exp); return; }
  const fold=e.target.closest('[data-fold]');
  if(fold){ setFolded(fold.dataset.fold,!state.folded.has(fold.dataset.fold)); return; }
  const bm=e.target.closest('[data-bm]');
  if(bm){
    const tr=bm.closest('tr.r');
    if(tr){ clearSel(); toggleBookmark(Number(tr.dataset.fi),Number(tr.dataset.i)); }
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
