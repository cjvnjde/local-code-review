import { NOTE_MAX, autogrow } from './autogrow.ts';
import { repaintRow } from './diff-view.ts';
import { updateCount } from './footer.ts';
import { editorAction } from './keys.ts';
import { save } from './persistence.ts';
import { clearSel } from './selection.ts';
import { FILE_ANCHOR, clip, el, esc, isFileNote, locKey, mintNoteId, rowKey, saveKeyHint, state, statusOf } from './state.ts';
import { renderTree } from './tree.ts';

/* ---------- notes ---------- */
function span(f,i,j,ch?){
  const rows=f.rows.slice(i,j+1).filter(r=>r.t!=='hunk');
  const ns=rows.filter(r=>r.n!=null).map(r=>r.n);
  const os=rows.filter(r=>r.n==null&&r.o!=null).map(r=>r.o);
  const nums=ns.length?ns:os;
  if(!nums.length) return {side:'new',start:0,end:0,label:'0',code:''};
  const start=Math.min.apply(null,nums), end=Math.max.apply(null,nums);
  const code=rows.map(r=>(r.t==='add'?'+':r.t==='del'?'-':' ')+r.text).join('\n');
  const out: any={side:ns.length?'new':'old',start,end,label:start===end?String(start):start+'-'+end,code};
  // Columns are 1-based and inclusive in the label; ch.cb is an exclusive offset.
  if(ch){ out.label+=':'+(ch.ca+1)+'-'+ch.cb; out.snippet=f.rows[i].text.slice(ch.ca,ch.cb); }
  return out;
}
function bounds(){
  const s=state.sel; if(!s) return null;
  const f=state.files[s.fi];
  let i=Math.min(s.a,s.b), j=Math.max(s.a,s.b);
  while(i<=j&&f.rows[i].t==='hunk') i++;
  while(j>=i&&f.rows[j].t==='hunk') j--;
  if(i>j) return null;
  // A character range only survives while the selection is still the single row it was taken from.
  const ch=s.ca!=null&&i===j&&i===s.a?{ca:s.ca,cb:s.cb}:null;
  return {f,fi:s.fi,i,j,ch};
}
/** Character ranges to paint inside one row: every saved sub-line note, plus the live selection. */
export function charMarks(f: any,fi: number,idx: number){
  const out: any[]=[], key=rowKey(f.rows[idx]);
  state.notes.forEach(n=>{ if(n.ca!=null&&n.file===f.path&&n.a===key) out.push({s:n.ca,e:n.cb,c:'cn'}); });
  const s=state.sel;
  if(s&&s.ca!=null&&s.fi===fi&&s.a===idx) out.push({s:s.ca,e:s.cb,c:'cs'});
  return out.length?out:null;
}
/** An untouched draft is disposable: a new click or shift-extend should move it, not stack a second box. */
function dropEmptyDraft(){
  const row=state.draftRow;
  state.draftRow=state.draftKey=null;
  if(!row||!row.isConnected) return;
  const ta=row.querySelector('textarea');
  if(ta&&!ta.value.trim()) row.remove();
}
/** The text box of the draft standing open on this exact range, if the last one opened is still there. */
function draftFor(key: string){
  const row=state.draftRow;
  if(!row||!row.isConnected||state.draftKey!==key) return null;
  return row.querySelector('textarea');
}
/** Opens a new note on the selected range. A range that already carries notes gets another one:
 *  a line can hold as many remarks as it earns, and each is edited from its own box. */
export function openEditor(){
  const b=bounds(); if(!b) return;
  const {f,fi,i,j,ch}=b;
  const anchor=el('r'+fi+'-'+j); if(!anchor) return;
  const a=rowKey(f.rows[i]), z=rowKey(f.rows[j]);
  const key=locKey(f.path,a,z,ch&&ch.ca,ch&&ch.cb);
  const open=draftFor(key);
  if(open){ open.focus(); return; }
  dropEmptyDraft();
  const id=mintNoteId(f.path,a,z,ch&&ch.ca,ch&&ch.cb);
  const box=mountRow(anchor,id);
  state.draftRow=rowOf(box); state.draftKey=key;
  editUI(box,{f,fi,i,j,ch,id,body:''});
}
/** A note on the file itself: no line anchor, one per file, mounted under the file header. */
export function openFileEditor(fi: number){
  const f=state.files[fi]; if(!f) return;
  const host=el('fn'+fi); if(!host) return;
  const kept=fileNoteOf(f.path);
  const id=kept?kept.id:mintNoteId(f.path,FILE_ANCHOR,FILE_ANCHOR);
  const ctx: any={f,fi,i:null,j:null,ch:null,scope:'file',id};
  const mounted=host.querySelector('.nrow');
  if(mounted!==state.draftRow) dropEmptyDraft();
  if(mounted&&mounted.isConnected){
    const ta=mounted.querySelector('textarea');
    if(ta){ ta.focus(); return; }
    editUI(mounted.querySelector('.nbox'),Object.assign({},ctx,{body:kept?kept.body:''}));
    return;
  }
  const box=mountFileBox(host,id);
  state.draftRow=rowOf(box); state.draftKey=locKey(f.path,FILE_ANCHOR,FILE_ANCHOR);
  editUI(box,ctx);
}
/** The file's own note, found by what it is anchored to rather than by a predictable id. */
const fileNoteOf=(path: string)=>[...state.notes.values()].find((n: any)=>n.file===path&&isFileNote(n))||null;
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
/** File notes live outside the table, so they carry the same `.nrow` wrapper without a cell. */
function mountFileBox(host,id){
  const row=document.createElement('div'); row.className='nrow'; row.dataset.nid=id;
  const box=document.createElement('div'); box.className='nbox';
  row.append(box); host.append(row);
  return box;
}
/** The wrapper a box lives in, whether that is a table row or a file-header block. */
const rowOf=(box: any)=>box.closest('.nrow');
/** What the agent reported for this note, sourced from the review file it wrote it in. */
function statusChip(st){
  if(!st) return '';
  return '<span class="stat '+esc(st.status)+'" title="'+esc(st.source+(st.detail?' — '+st.detail:''))+'">'+
    esc(st.status.replace('-',' '))+'</span>';
}
/** A missing label means the note covers the file, so the head says so instead of naming lines. */
function headHtml(f,label,snippet,extra){
  return '<div class="nhead"><span class="loc">'+esc(f.path)+(label?':'+label:'')+'</span>'+
    (label?'':'<span class="all">whole file</span>')+
    (snippet?'<span class="snip" title="'+esc(snippet)+'">'+esc(clip(snippet.trim()))+'</span>':'')+
    '<span class="spacer"></span>'+(extra||'')+'</div>';
}
function editUI(box,ctx){
  const {f,fi,i,j,ch,id}=ctx;
  const whole=ctx.scope==='file';
  const sp=whole?null:span(f,i,j,ch);
  box.innerHTML=headHtml(f,whole?null:sp.label,whole?null:sp.snippet)+
    '<div class="nedit"><textarea placeholder="'+(whole?'What should change in this file?':
      ch?'What should change in this part of the line?':'What should change here?')+'"></textarea>'+
    '<div class="acts"><button class="primary">Save note</button><button class="cancel">Cancel</button>'+
    '<span class="spacer"></span><span class="tip">'+saveKeyHint()+' save &middot; esc cancel</span></div></div>';
  const ta=box.querySelector('textarea');
  ta.value=ctx.body||'';
  autogrow(ta,NOTE_MAX); // after the value, so reopening a long note opens it at full height
  ta.focus();
  const commit=()=>{
    const body=ta.value.trim();
    if(!body){ drop(); return; }
    const note: any=whole
      ?{id,file:f.path,body,a:FILE_ANCHOR,b:FILE_ANCHOR,scope:'file',start:0,end:0}
      :{id,file:f.path,body,a:rowKey(f.rows[i]),b:rowKey(f.rows[j]),
        side:sp.side,start:sp.start,end:sp.end,label:sp.label,code:sp.code};
    if(ch){ note.ca=ch.ca; note.cb=ch.cb; note.snippet=sp.snippet; }
    state.notes.set(id,note);
    save(); clearSel();
    viewUI(box,note,ctx);
    mark(fi,i,j,true);
    if(ch) repaintRow(fi,i);
    renderTree(); updateCount();
  };
  const drop=()=>{
    if(state.notes.has(id)){ state.notes.delete(id); save(); remark(f,fi,i,j); renderTree(); updateCount(); }
    rowOf(box).remove(); clearSel();
    if(ch) repaintRow(fi,i);
  };
  box.querySelector('.primary').onclick=commit;
  box.querySelector('.cancel').onclick=()=>{
    const kept=state.notes.get(id);
    clearSel();
    if(kept) viewUI(box,kept,ctx);
    else rowOf(box).remove();
  };
  ta.onkeydown=e=>{
    const action=editorAction(e,state.cfg.enterSaves);
    if(action==='save'){ e.preventDefault(); commit(); }
    if(action==='cancel'){ e.preventDefault(); box.querySelector('.cancel').click(); }
  };
}
function viewUI(box,note,ctx){
  const st=statusOf(note);
  box.classList.toggle('done',!!st&&st.status==='applied');
  box.innerHTML=headHtml(ctx.f,note.label,note.snippet,
      statusChip(st)+'<button class="edit">Edit</button><button class="danger del">Delete</button>')+
    '<div class="nbody"></div>'+(st&&st.detail?'<div class="nstat"></div>':'');
  box.querySelector('.nbody').textContent=note.body;
  if(st&&st.detail) box.querySelector('.nstat').textContent=st.status.replace('-',' ')+' — '+st.detail;
  box.querySelector('.edit').onclick=()=>editUI(box,Object.assign({},ctx,{id:note.id,body:note.body}));
  box.querySelector('.del').onclick=()=>{
    state.notes.delete(note.id); save();
    remark(ctx.f,ctx.fi,ctx.i,ctx.j);
    rowOf(box).remove();
    if(note.ca!=null) repaintRow(ctx.fi,ctx.i);
    renderTree(); updateCount();
  };
}
function mark(fi,i,j,on){
  if(i==null) return; // a file note marks no lines
  for(let k=i;k<=j;k++){
    const tr=el('r'+fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.toggle('noted',on);
  }
}
/** Repaints a span a note has just left: the lines under it may still be covered by other notes. */
function remark(f,fi,i,j){
  if(i==null) return; // a file note marks no lines
  const ki=keyIndex(f), spans=[];
  state.notes.forEach((n: any)=>{
    if(n.file!==f.path||isFileNote(n)) return;
    const a=ki.has(n.a)?ki.get(n.a):-1, b=ki.has(n.b)?ki.get(n.b):-1;
    if(a>=0&&b>=a) spans.push([a,b]);
  });
  for(let k=i;k<=j;k++){
    const tr=el('r'+fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.toggle('noted',spans.some(s=>s[0]<=k&&k<=s[1]));
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
/** Mounts the file's own note, if it has one, under a freshly rendered file header. */
export function applyFileNote(f: any,fi: number){
  const host=el('fn'+fi); if(!host) return;
  const n=fileNoteOf(f.path);
  if(!n||host.querySelector('.nrow')) return;
  viewUI(mountFileBox(host,n.id),n,{f,fi,i:null,j:null,ch:null,scope:'file'});
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
    const ch=n.ca!=null?{ca:n.ca,cb:n.cb}:null;
    if(!rowFor(anchor,n.id)) viewUI(mountRow(anchor,n.id),n,{f,fi,i,j,ch});
  });
}
