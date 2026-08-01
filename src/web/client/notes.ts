import { updateCount } from './footer.ts';
import { save } from './persistence.ts';
import { clearSel } from './selection.ts';
import { el, esc, noteId, rowKey, state } from './state.ts';
import { renderTree } from './tree.ts';

/* ---------- notes ---------- */
function span(f,i,j){
  const rows=f.rows.slice(i,j+1).filter(r=>r.t!=='hunk');
  const ns=rows.filter(r=>r.n!=null).map(r=>r.n);
  const os=rows.filter(r=>r.n==null&&r.o!=null).map(r=>r.o);
  const nums=ns.length?ns:os;
  if(!nums.length) return {side:'new',start:0,end:0,label:'0',code:''};
  const start=Math.min.apply(null,nums), end=Math.max.apply(null,nums);
  const code=rows.map(r=>(r.t==='add'?'+':r.t==='del'?'-':' ')+r.text).join('\n');
  return {side:ns.length?'new':'old',start,end,label:start===end?String(start):start+'-'+end,code};
}
function bounds(){
  const s=state.sel; if(!s) return null;
  const f=state.files[s.fi];
  let i=Math.min(s.a,s.b), j=Math.max(s.a,s.b);
  while(i<=j&&f.rows[i].t==='hunk') i++;
  while(j>=i&&f.rows[j].t==='hunk') j--;
  if(i>j) return null;
  return {f,fi:s.fi,i,j};
}
/** An untouched draft is disposable: a new click or shift-extend should move it, not stack a second box. */
function dropEmptyDraft(){
  const row=state.draftRow;
  state.draftRow=null;
  if(!row||!row.isConnected) return;
  const ta=row.querySelector('textarea');
  if(ta&&!ta.value.trim()) row.remove();
}
export function openEditor(){
  const b=bounds(); if(!b) return;
  const {f,fi,i,j}=b;
  const anchor=el('r'+fi+'-'+j); if(!anchor) return;
  const id=noteId(f.path,rowKey(f.rows[i]),rowKey(f.rows[j]));
  const mounted=rowFor(anchor,id);
  if(mounted!==state.draftRow) dropEmptyDraft();
  if(mounted&&mounted.isConnected){
    const ta=mounted.querySelector('textarea');
    if(ta) ta.focus();
    else editUI(mounted.querySelector('.nbox'),{f,fi,i,j,id,body:state.notes.get(id).body});
    return;
  }
  const existing=state.notes.get(id);
  const box=mountRow(anchor,id);
  state.draftRow=box.parentElement.parentElement;
  editUI(box,{f,fi,i,j,id,body:existing?existing.body:''});
}
/** Several ranges can end on the same row, so each note row is tagged and matched by id. */
function rowFor(anchor,id){
  let n=anchor.nextElementSibling;
  while(n&&n.classList.contains('nrow')){
    if(n.dataset.nid===id) return n;
    n=n.nextElementSibling;
  }
  return null;
}
function mountRow(anchor,id){
  let after=anchor;
  while(after.nextElementSibling&&after.nextElementSibling.classList.contains('nrow')) after=after.nextElementSibling;
  const row=document.createElement('tr'); row.className='nrow'; row.dataset.nid=id;
  const td=document.createElement('td'); td.colSpan=4;
  const box=document.createElement('div'); box.className='nbox';
  td.append(box); row.append(td); after.after(row);
  return box;
}
function headHtml(f,label,extra){
  return '<div class="nhead"><span class="loc">'+esc(f.path)+':'+label+'</span><span class="spacer"></span>'+(extra||'')+'</div>';
}
function editUI(box,ctx){
  const {f,fi,i,j,id}=ctx;
  const sp=span(f,i,j);
  box.innerHTML=headHtml(f,sp.label)+'<div class="nedit"><textarea placeholder="What should change here?"></textarea>'+
    '<div class="acts"><button class="primary">Save note</button><button class="cancel">Cancel</button>'+
    '<span class="spacer"></span><span class="tip">cmd/ctrl+enter save &middot; esc cancel</span></div></div>';
  const ta=box.querySelector('textarea');
  ta.value=ctx.body||'';
  ta.focus();
  const commit=()=>{
    const body=ta.value.trim();
    if(!body){ drop(); return; }
    const note={id,file:f.path,body,a:rowKey(f.rows[i]),b:rowKey(f.rows[j]),
      side:sp.side,start:sp.start,end:sp.end,label:sp.label,code:sp.code};
    state.notes.set(id,note);
    save(); clearSel();
    viewUI(box,note,{f,fi,i,j});
    mark(fi,i,j,true);
    renderTree(); updateCount();
  };
  const drop=()=>{
    if(state.notes.has(id)){ state.notes.delete(id); save(); mark(fi,i,j,false); renderTree(); updateCount(); }
    box.parentElement.parentElement.remove(); clearSel();
  };
  box.querySelector('.primary').onclick=commit;
  box.querySelector('.cancel').onclick=()=>{
    const kept=state.notes.get(id);
    clearSel();
    if(kept) viewUI(box,kept,{f,fi,i,j});
    else box.parentElement.parentElement.remove();
  };
  ta.onkeydown=e=>{
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ e.preventDefault(); commit(); }
    if(e.key==='Escape'){ e.preventDefault(); box.querySelector('.cancel').click(); }
  };
}
function viewUI(box,note,ctx){
  box.innerHTML=headHtml(ctx.f,note.label,'<button class="edit">Edit</button><button class="danger del">Delete</button>')+
    '<div class="nbody"></div>';
  box.querySelector('.nbody').textContent=note.body;
  box.querySelector('.edit').onclick=()=>editUI(box,Object.assign({},ctx,{id:note.id,body:note.body}));
  box.querySelector('.del').onclick=()=>{
    state.notes.delete(note.id); save();
    mark(ctx.fi,ctx.i,ctx.j,false);
    box.parentElement.parentElement.remove();
    renderTree(); updateCount();
  };
}
function mark(fi,i,j,on){
  for(let k=i;k<=j;k++){
    const tr=el('r'+fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.toggle('noted',on);
  }
}
function keyIndex(f){
  if(!f.ki){
    const m=new Map();
    f.rows.forEach((r,i)=>{ if(r.t!=='hunk') m.set(rowKey(r),i); });
    f.ki=m;
  }
  return f.ki;
}
export function applyNotesIn(f: any,fi: number,from: number,to: number){
  const ki=keyIndex(f);
  state.notes.forEach(n=>{
    if(n.file!==f.path) return;
    const i=ki.has(n.a)?ki.get(n.a):-1, j=ki.has(n.b)?ki.get(n.b):-1;
    if(i<0||j<0||j<i||j<from||i>=to) return;
    mark(fi,Math.max(i,from),Math.min(j,to-1),true);
    if(j<from||j>=to) return; // the box belongs to the block holding the last row
    const anchor=el('r'+fi+'-'+j); if(!anchor) return;
    const id=n.id||noteId(n.file,n.a,n.b);
    if(!rowFor(anchor,id)) viewUI(mountRow(anchor,id),n,{f,fi,i,j});
  });
}
