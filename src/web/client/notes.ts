import { placeOf } from './anchor.ts';
import { NOTE_MAX, autogrow } from './autogrow.ts';
import { globalHost, repaintRow, syncGlobals } from './diff-view.ts';
import { updateCount } from './footer.ts';
import { codeHtml, langOf } from './highlight.ts';
import { editorAction } from './keys.ts';
import { save, withdrawNotes } from './persistence.ts';
import { clearSel } from './selection.ts';
import { FILE_ANCHOR, GLOBAL_ANCHOR, SVG, clip, el, esc, isFileNote, isGlobalNote, keyIndex, locKey, markRead, mintGlobalId, mintNoteId, rowKey, saveKeyHint, state, statusOf, unreadOf } from './state.ts';
import { insertBlock, suggestLines, suggestionBlock } from './suggest.ts';
import { dropEmptyReply, mountReply, renderBody, renderThread } from './thread.ts';
import { renderTree } from './tree.ts';

/* ---------- notes ---------- */
export function span(f,i,j,ch?){
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
/**
 * The stored offsets, re-read against the text they point into. A row that still holds the note's
 * code can have shifted under it — a re-indent keeps it `exact` — so the snippet is what says where
 * the range now sits; offsets whose snippet has left the line entirely point at nothing.
 */
function charSpan(n: any,text: string){
  if(n.ca==null) return null;
  if(!n.snippet||text.slice(n.ca,n.cb)===n.snippet) return {ca:n.ca,cb:n.cb};
  const at=text.indexOf(n.snippet);
  return at<0?null:{ca:at,cb:at+n.snippet.length};
}
/** Character ranges to paint inside one row: every saved sub-line note, plus the live selection. */
export function charMarks(f: any,fi: number,idx: number){
  const out: any[]=[];
  state.notes.forEach(n=>{
    if(n.ca==null||n.file!==f.path) return;
    // Where the note is showing, which after an edit need not be the row it was written on.
    const p=placeOf(n);
    if(!p||p.i!==idx||p.how==='near') return;
    const span=charSpan(n,f.rows[idx].text);
    if(span) out.push({s:span.ca,e:span.cb,c:'cn'});
  });
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
  if(!ta||ta.value.trim()) return;
  row.remove();
  syncGlobals(); // it may have been the only thing in the card at the top
}
/** The text box of the draft standing open on this exact range, if the last one opened is still there. */
function draftFor(key: string){
  const row=state.draftRow;
  if(!row||!row.isConnected||state.draftKey!==key) return null;
  return row.querySelector('textarea');
}
/**
 * The page holds one editor open at a time, replies included. A second box would leave the first one
 * behind, half written and out of view, so an untouched draft steps aside and anything else keeps the
 * floor and is brought back into view instead.
 */
export function busyEditor(){
  dropEmptyDraft();
  dropEmptyReply();
  const ta: any=document.querySelector('.nbox textarea');
  if(!ta||!ta.isConnected) return false;
  const box=ta.closest('.nbox');
  if(box){
    box.scrollIntoView({block:'nearest'});
    box.classList.remove('bump');
    void box.offsetWidth; // restart the pulse when the same box is asked for twice
    box.classList.add('bump');
  }
  ta.focus();
  return true;
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
  if(busyEditor()){ clearSel(); return; }
  const id=mintNoteId(f.path,a,z,ch&&ch.ca,ch&&ch.cb);
  const box=mountRow(anchor,id);
  state.draftRow=rowOf(box); state.draftKey=key;
  editUI(box,{f,fi,i,j,ch,id,body:''});
}
/** A note on the file itself: no line anchor, one per file, mounted under the file header. */
export function openFileEditor(fi: number){
  const f=state.files[fi]; if(!f) return;
  const host=el('fn'+fi); if(!host) return;
  const mounted=host.querySelector('.nrow');
  const standing=mounted&&mounted.isConnected?mounted.querySelector('textarea'):null;
  if(standing){ standing.focus(); return; }
  if(busyEditor()) return;
  const kept=fileNoteOf(f.path);
  const id=kept?kept.id:mintNoteId(f.path,FILE_ANCHOR,FILE_ANCHOR);
  const ctx: any={f,fi,i:null,j:null,ch:null,scope:'file',id};
  if(mounted&&mounted.isConnected){
    editUI(mounted.querySelector('.nbox'),Object.assign({},ctx,{body:kept?kept.body:''}));
    return;
  }
  const box=mountFileBox(host,id);
  state.draftRow=rowOf(box); state.draftKey=locKey(f.path,FILE_ANCHOR,FILE_ANCHOR);
  editUI(box,ctx);
}
/**
 * A note about the review as a whole. It is a note like any other — its own thread, its own verdict,
 * as many as the review earns — and the only thing it does not have is somewhere in the diff to sit,
 * so it lives in the card above the first file rather than against a line.
 */
export function openGlobalEditor(){
  // Asked before the card is made, so a refused open leaves no empty card standing over the diff.
  if(busyEditor()) return;
  const host=globalHost(true); if(!host) return;
  const id=mintGlobalId();
  const box=mountFileBox(host,id);
  state.draftRow=rowOf(box); state.draftKey=locKey('',GLOBAL_ANCHOR,GLOBAL_ANCHOR);
  const card=el('fglobal');
  if(card) card.scrollIntoView({block:'start'});
  editUI(box,{f:{path:'',rows:[]},fi:-1,i:null,j:null,ch:null,scope:'global',id,body:''});
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
/**
 * What a note says it is about. A note on the whole review names no file, one on a whole file names
 * no lines, and the badge under `all` is what carries that instead of a line range.
 */
function headHtml(f,label,snippet,extra,scope?){
  const global=scope==='global';
  return '<div class="nhead"><span class="loc">'+(global?'Overall':esc(f.path)+(label?':'+label:''))+'</span>'+
    (global?'<span class="all">whole review</span>':label?'':'<span class="all">whole file</span>')+
    (snippet?'<span class="snip" title="'+esc(snippet)+'">'+esc(clip(snippet.trim()))+'</span>':'')+
    '<span class="spacer"></span>'+(extra||'')+'</div>';
}
function editUI(box,ctx){
  const {f,fi,i,j,ch,id}=ctx;
  const global=ctx.scope==='global';
  const whole=global||ctx.scope==='file';
  const sp=whole?null:span(f,i,j,ch);
  // A note covering no lines has nothing to suggest a replacement for.
  const suggest=whole?'':'<button class="sug" title="Insert these lines as a suggested change">'+
    SVG.plus+' suggest</button>';
  box.innerHTML=headHtml(f,whole?null:sp.label,whole?null:sp.snippet,suggest,ctx.scope)+
    '<div class="nedit"><textarea placeholder="'+
      (global?'What should be said about this review as a whole?':
      whole?'What should change in this file?':
      ch?'What should change in this part of the line?':'What should change here?')+'"></textarea>'+
    '<div class="acts"><button class="primary">Save note</button><button class="cancel">Cancel</button>'+
    '<span class="spacer"></span><span class="tip">'+saveKeyHint()+' save &middot; esc cancel</span></div></div>';
  const ta=box.querySelector('textarea');
  ta.value=ctx.body||'';
  const fit=autogrow(ta,NOTE_MAX); // after the value, so reopening a long note opens it at full height
  ta.focus();
  const sug=box.querySelector('.sug');
  // The suggestion is seeded with whole lines even for a note on part of one: it replaces lines.
  if(sug) sug.onclick=()=>{
    const {value,to}=insertBlock(ta.value,ta.selectionStart,
      suggestionBlock(suggestLines(f.rows.slice(i,j+1))));
    ta.value=value; fit();
    ta.focus(); ta.setSelectionRange(to,to);
  };
  const commit=()=>{
    const body=ta.value.trim();
    if(!body){ drop(); return; }
    const kept=state.notes.get(id);
    const note: any=global
      ?{id,file:'',body,a:GLOBAL_ANCHOR,b:GLOBAL_ANCHOR,scope:'global',start:0,end:0}
      :whole
      ?{id,file:f.path,body,a:FILE_ANCHOR,b:FILE_ANCHOR,scope:'file',start:0,end:0}
      :{id,file:f.path,body,a:rowKey(f.rows[i]),b:rowKey(f.rows[j]),
        side:sp.side,start:sp.start,end:sp.end,label:sp.label,code:sp.code};
    if(ch){ note.ca=ch.ca; note.cb=ch.cb; note.snippet=sp.snippet; }
    // Editing a note that is already in the review file leaves it in the same conversation.
    if(kept&&kept.sentAt) note.sentAt=kept.sentAt;
    state.notes.set(id,note);
    state.place.set(id,global?{fi:-1,i:-1,j:-1,how:'global'}
      :whole?{fi,i:-1,j:-1,how:'file'}:{fi,i,j,how:'exact'});
    save(); clearSel();
    viewUI(box,note,ctx);
    repaintNote(id,box); // the same note may be mounted in the all-notes panel as well
    mark(fi,i,j,true);
    if(ch) repaintRow(fi,i);
    renderTree(); updateCount();
  };
  const drop=()=>{
    // Emptying a saved note is deleting it, and deleting is what takes it out of the review file
    // too; only a draft that never existed comes down with no more ceremony than cancel.
    const kept=state.notes.get(id);
    if(kept){ clearSel(); removeNote(box,kept,ctx); return; }
    rowOf(box).remove(); clearSel();
    if(ch) repaintRow(fi,i);
    syncGlobals(); // the card the draft opened has nothing left to hold
  };
  box.querySelector('.primary').onclick=commit;
  box.querySelector('.cancel').onclick=()=>{
    const kept=state.notes.get(id);
    clearSel();
    if(kept) viewUI(box,kept,ctx);
    else{ rowOf(box).remove(); syncGlobals(); }
  };
  ta.onkeydown=e=>{
    const action=editorAction(e,state.cfg.enterSaves);
    if(action==='save'){ e.preventDefault(); commit(); }
    if(action==='cancel'){ e.preventDefault(); box.querySelector('.cancel').click(); }
  };
}
/**
 * What a note's placement has to say for itself. Only the two cases with no anchor left say anything:
 * a note that merely followed its code, or settled for the nearest line, already shows that in the
 * heading over its captured code, and a sentence repeating it is noise on every note the agent touches.
 */
const PLACING={
  loose:['no place in this file','Nothing in this file matches what the note was written on, and no line is near enough. It is kept here, under the file it belongs to.'],
  stray:['file not in this diff','The file this note was written on has no changes left in the diff, so there is nowhere to attach it.'],
};
function placeHtml(how: string){
  const entry=PLACING[how];
  if(!entry) return '';
  return '<div class="lost" title="'+esc(entry[1])+'"><span class="tag">'+esc(entry[0])+'</span>'+
    '<span class="why">'+esc(entry[1])+'</span></div>';
}
/**
 * The lines the note was written on, kept with the note itself. A note is read a long way from where
 * it was made — under the file, at the end of the page, or after the agent has rewritten everything
 * around it — so it carries its own subject rather than relying on the row above it.
 *
 * The heading is where a note says its code has gone. `exact` and `moved` are both sitting on the code
 * they captured, wherever in the file that now is, so they read as the code in front of you; the rest
 * are showing a record of code the diff no longer has.
 */
function capturedHtml(note: any,how: string){
  if(!note.code||!note.code.trim()) return '';
  const lang=langOf(note.file);
  const rows=note.code.split('\n').map((line: string)=>{
    const t=line[0]==='+'?'add':line[0]==='-'?'del':'ctx';
    return '<div class="cl '+t+'"><span class="cm">'+esc(line[0]||' ')+'</span>'+
      '<span class="c">'+codeHtml(line.slice(1),lang)+'</span></div>';
  }).join('');
  const here=how==='exact'||how==='moved'||how==='file';
  return '<div class="cap'+(here?'':' was')+'"><div class="caph">'+
    (here?'commented on':'commented on — this code is no longer in the diff')+'</div>'+
    '<div class="capc">'+rows+'</div></div>';
}
export function viewUI(box,note,ctx){
  const st=statusOf(note);
  const how=ctx.how||'exact';
  const lost=how==='loose'||how==='stray';
  const unread=unreadOf(note);
  // A note read away from the diff needs the way back to it. Read off the DOM rather than passed in,
  // so a note repainted by a reply or a verdict keeps the button wherever it is mounted.
  const away=!!box.closest('.rdr');
  box.classList.toggle('done',!!st&&st.status==='applied');
  box.classList.toggle('adrift',lost);
  box.classList.toggle('unread-on',!!unread);
  box.innerHTML=headHtml(ctx.f,note.label,note.snippet,
      '<span class="unread"'+(unread?'':' hidden')+'>'+(unread?unread+' new':'')+'</span>'+
      statusChip(st)+
      (away?'<button class="jmp" data-goto="'+esc(note.id)+
        '" title="Show this note where it sits in the diff">'+
        (ctx.scope==='global'?'show':'in diff')+'</button>':'')+
      '<button class="edit">Edit</button><button class="danger del">Delete</button>',ctx.scope)+
    placeHtml(how==='exact'||how==='file'||how==='global'?'':how)+
    capturedHtml(note,how)+
    '<div class="nbody"></div>'+(st&&st.detail?'<div class="nstat"></div>':'')+
    '<div class="thread"></div><div class="replyhost"></div>';
  renderBody(box.querySelector('.nbody'),note.body,note.file);
  if(st&&st.detail) box.querySelector('.nstat').textContent=st.status.replace('-',' ')+' — '+st.detail;
  renderThread(box.querySelector('.thread'),note);
  mountReply(box.querySelector('.replyhost'),note,()=>repaintNote(note.id));
  // Looking at a note is what reads its thread; the count in the footer follows from that. The box
  // outlives its contents, so the listener is attached once and finds the note again when it fires.
  if(!box.__read){
    box.__read=true;
    box.addEventListener('click',()=>{
      const id=rowOf(box)?.dataset.nid;
      const seen=id&&state.notes.get(id);
      if(!seen||!markRead(seen)) return;
      save(); updateCount();
      box.classList.remove('unread-on');
      const chip=box.querySelector('.unread');
      if(chip){ chip.hidden=true; chip.textContent=''; }
      box.querySelectorAll('.msg.fresh').forEach((m: any)=>m.classList.remove('fresh'));
    });
  }
  box.querySelector('.edit').onclick=()=>{
    if(busyEditor()) return;
    if(lost||how==='near'){
      alert('This note has no lines to edit against any more. Reply to it instead, or delete it.');
      return;
    }
    editUI(box,Object.assign({},ctx,{id:note.id,body:note.body}));
  };
  box.querySelector('.del').onclick=()=>removeNote(box,note,ctx);
}
/** Deleting a note that was handed over takes it out of the review file too, thread and all. */
function removeNote(box,note,ctx){
  if(note.sentAt&&!confirm('Delete this note?\n\nIt is in '+(state.sessionFile||'the review file')+
    ', so its thread goes with it.')) return;
  state.notes.delete(note.id);
  state.msgs.delete(note.id);
  state.seen.delete(note.id);
  state.place.delete(note.id);
  save();
  if(ctx.f&&ctx.i!=null&&ctx.i>=0) remark(ctx.f,ctx.fi,ctx.i,ctx.j);
  // Every box the note had, not only the one deleted from: it may also be mounted in the panel.
  document.querySelectorAll('.nrow').forEach((row: any)=>{ if(row.dataset.nid===note.id) row.remove(); });
  if(note.ca!=null&&ctx.i!=null&&ctx.i>=0) repaintRow(ctx.fi,ctx.i);
  syncGlobals(); // the card at the top goes with the last note in it
  renderTree(); updateCount();
  if(note.sentAt) withdrawNotes([note.id]);
}
function mark(fi,i,j,on){
  if(i==null||i<0) return; // a file note, or one with no rows left, marks no lines
  for(let k=i;k<=j;k++){
    const tr=el('r'+fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.toggle('noted',on);
  }
}
/** Repaints a span a note has just left: the lines under it may still be covered by other notes. */
function remark(f,fi,i,j){
  if(i==null||i<0) return; // a file note marks no lines
  const spans=[];
  state.notes.forEach((n: any)=>{
    if(n.file!==f.path||isFileNote(n)) return;
    const p=placeOf(n);
    if(p&&p.i>=0) spans.push([p.i,p.j]);
  });
  for(let k=i;k<=j;k++){
    const tr=el('r'+fi+'-'+k);
    if(tr&&tr.classList.contains('r')) tr.classList.toggle('noted',spans.some(s=>s[0]<=k&&k<=s[1]));
  }
}
/** Mounts the file's own note, if it has one, under a freshly rendered file header. */
export function applyFileNote(f: any,fi: number){
  const host=el('fn'+fi); if(!host) return;
  const n=fileNoteOf(f.path);
  if(!n||host.querySelector('.nrow')) return;
  viewUI(mountFileBox(host,n.id),n,{f,fi,i:null,j:null,ch:null,scope:'file',how:'file'});
}
export function applyNotesIn(f: any,fi: number,from: number,to: number){
  keyIndex(f); // built once here, so every placement below reads the same index
  state.notes.forEach(n=>{
    if(n.file!==f.path) return;
    const p=placeOf(n);
    if(!p||p.i<0) return;
    const i=p.i, j=p.j;
    if(j<from||i>=to) return;
    mark(fi,Math.max(i,from),Math.min(j,to-1),true);
    if(j<from||j>=to) return; // the box belongs to the block holding the last row
    const anchor=el('r'+fi+'-'+j); if(!anchor) return;
    const ch=n.ca!=null&&p.how!=='near'?charSpan(n,f.rows[i].text):null;
    if(!rowFor(anchor,n.id)) viewUI(mountRow(anchor,n.id),n,{f,fi,i,j,ch,how:p.how});
  });
}
/** Mounts a note that has no row of its own, inside whichever holding block it belongs to. */
export function mountLoose(host: any,note: any,f: any,fi: number,how: string){
  const box=mountFileBox(host,note.id);
  viewUI(box,note,{f,fi,i:null,j:null,ch:null,how});
}
/**
 * How a note is drawn wherever it is mounted, worked out from where the diff places it now rather
 * than from where it was written. Edit reads the note's shape off this, so a whole-file note must
 * say it is one here too.
 */
function ctxFor(n: any){
  if(isGlobalNote(n)) return {f:{path:'',rows:[]},fi:-1,i:null,j:null,ch:null,how:'global',scope:'global'};
  const p=placeOf(n);
  const f=p?state.files[p.fi]:{path:n.file,rows:[]};
  const how=p?p.how:'stray';
  const ch=n.ca!=null&&how!=='near'&&p&&p.i>=0&&f.rows[p.i]?charSpan(n,f.rows[p.i].text):null;
  const ctx: any={f,fi:p?p.fi:-1,i:p?p.i:null,j:p?p.j:null,ch,how};
  if(isFileNote(n)) ctx.scope='file';
  return ctx;
}
/** Mounts one of the review's own notes in the card above the diff. */
export function mountGlobal(host: any,note: any){
  viewUI(mountFileBox(host,note.id),note,ctxFor(note));
}
/**
 * Mounts a note somewhere that is not the row it belongs to — the all-notes panel reads the whole
 * review this way. It is the same box the diff shows, so everything a note can do it can do here.
 */
export function mountNoteIn(host: any,note: any){
  const box=mountFileBox(host,note.id);
  viewUI(box,note,ctxFor(note));
  return box;
}
/**
 * Redraws one note wherever it is mounted, for a reply or a verdict that arrived from the review
 * file. A box being typed into is left alone: the news can wait until the note is finished. `skip` is
 * the box whose own change started this, which has already been drawn with what it knows.
 */
export function repaintNote(id: string,skip?: any){
  const n=state.notes.get(id); if(!n) return;
  const ctx=ctxFor(n);
  document.querySelectorAll('.nrow').forEach((row: any)=>{
    if(row.dataset.nid!==id) return;
    const box=row.querySelector('.nbox');
    if(!box||box===skip||box.querySelector('textarea')) return;
    viewUI(box,n,ctx);
  });
}
