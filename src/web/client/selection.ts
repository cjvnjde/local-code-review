import { toggleBookmark } from './bookmark-pane.ts';
import { repaintRow, setFolded, setHidden, setViewed } from './diff-view.ts';
import { atStart, charRange, leftRow, pressKind } from './drag.ts';
import { expandGap } from './expand.ts';
import { isHidden } from './filters.ts';
import { openEditor, openFileEditor, openGlobalEditor } from './notes.ts';
import { el, idxOf, state } from './state.ts';

/* ---------- selection ---------- */
let drag: any=null;
/** Row whose code cell currently carries the character highlight, so it can be cleaned up. */
let charRow: any=null;
const sameRow=(a: any,b: any)=>!!a&&!!b&&a.fi===b.fi&&a.i===b.i;
/**
 * `keep` is the row a live press landed in, whose code cell is left exactly as it stands. The browser
 * anchors the text drag it is about to start on a node a repaint would replace, so repainting now
 * would cost the drag everything it goes on to collect — which is what a character range on a line
 * that already carries one is made of. Every way of finishing the press paints again, and that paint
 * is what takes the old range off the row.
 */
export function paintSel(keep?: any){
  el('diff').querySelectorAll('tr.sel').forEach(tr=>tr.classList.remove('sel'));
  const s=state.sel;
  const next=s&&s.ca!=null?{fi:s.fi,i:s.a}:null;
  const prev=charRow;
  if(!sameRow(prev,keep)){
    charRow=next;
    if(prev&&!sameRow(prev,next)) repaintRow(prev.fi,prev.i);
    if(next) repaintRow(next.fi,next.i);
  }
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
  // Pressing on code may be the start of a fragment on this very row, so the row keeps what it shows
  // until the press says what it meant; the gutter cannot start one and repaints straight away.
  paintSel(cell?{fi,i}:null);
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
  const d=drag; drag=null;
  document.body.classList.remove('dragging');
  // `rows` already holds its own answer in state.sel — rows, or the plain line the drag came back to —
  // and the highlight it brushed on the way, a shift-extend's included, was never the point of it.
  const kind=pressKind(d,e.clientX,e.clientY);
  const cs=kind==='chars'?charSel(d.cell):null;
  // Narrowing to part of a line, and re-picking that part, both land here: the fragment is read off
  // the browser highlight, which the paint below replaces. A press that collected nothing narrower
  // than the line leaves the highlight alone, so selecting a line to copy it still copies.
  const took=kind==='rows'||!!cs;
  if(took) dropTextSel();
  if(cs) state.sel=cs;
  paintSel(); // the row the press held now shows whatever it settled on, line or fragment
  // A press that settled on the plain line leaves the editor to the click behind it, which is also
  // what turns a line already narrowed to a fragment back into a note on the whole line.
  if(took) openEditor();
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
  const gn=e.target.closest('[data-gn]');
  if(gn){ clearSel(); openGlobalEditor(); return; }
  const tr=e.target.closest('tr.r');
  if(!tr||e.target.closest('.nbox')) return;
  if(state.sel&&state.sel.ca!=null) return; // mouseup already opened the editor for this range
  if(textSelected()){ clearSel(); return; }
  const fi=Number(tr.dataset.fi), i=Number(tr.dataset.i);
  if(!state.sel||state.sel.fi!==fi){ state.sel={fi,a:i,b:i}; paintSel(); }
  openEditor();
});
