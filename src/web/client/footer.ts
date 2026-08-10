import { GENERAL_MAX, autogrow } from './autogrow.ts';
import { hiddenCount } from './filters.ts';
import { load, render } from './load.ts';
import { clearNotes, save } from './persistence.ts';
import { SVG, appliedNotes, el, esc, markSubmitted, state, unreadTotal } from './state.ts';

/* ---------- footer ---------- */
/** Call after setting `#general` from code — only typing grows the box on its own. */
export const fitGeneral=autogrow(el('general'),GENERAL_MAX);
export function updateCount(){
  const n=state.notes.size, hid=hiddenCount(), seen=state.viewed.size, done=appliedNotes().length;
  const news=unreadTotal();
  el('count').textContent=n+(n===1?' note':' notes')+
    (state.files.length?' · '+seen+'/'+state.files.length+' viewed':'')+
    (hid?' · '+hid+' hidden':'')+
    (done?' · '+done+' applied':'');
  const inbox=el('unread');
  inbox.hidden=!news;
  inbox.textContent=news+(news===1?' new reply':' new replies');
  const btn=el('clearDone');
  btn.hidden=!done;
  btn.textContent='Remove '+done+' applied';
  btn.title=done?'Remove notes an agent reported as applied in a saved review file':'';
  /** Reset sits in settings, where nothing else counts the marks, so its label is written here. */
  const rv=el('resetViewed');
  rv.disabled=!seen;
  rv.textContent=seen?'Reset '+seen+' viewed file'+(seen===1?'':'s'):'Reset viewed files';
  rv.title=seen?'Mark every file in this diff as not viewed':'No file is marked viewed yet';
  /** Always on show, so starting over is findable; disabled is the honest state when nothing is stored. */
  const all=el('clearAll');
  const empty=!n&&!el('general').value.trim();
  all.disabled=empty;
  all.title=empty?'Nothing to clear yet'
    :'Delete every note and the overall note saved for this diff — '+
      'files that had notes go back to not viewed, the rest keep their mark';
  paintSubmit();
}
/** The button says whether this save opens the conversation or adds to the one already running. */
function paintSubmit(){
  const button=el('submit');
  const running=!!state.sessionFile;
  button.textContent=running?'Update review':'Save review';
  button.title=running?'Write these notes into '+state.sessionFile:'Start a review file for these notes';
}
/** Notes an agent already applied are finished business; dropping them keeps the next pass clean. */
el('clearDone').onclick=()=>{
  const done=appliedNotes();
  if(!done.length) return;
  if(!confirm('Remove '+done.length+' note'+(done.length===1?'':'s')+' reported as applied?')) return;
  done.forEach(n=>{
    state.notes.delete(n.id);
    state.msgs.delete(n.id);
    state.seen.delete(n.id);
    state.place.delete(n.id);
    if(n.sentAt) fetch('/api/note?id='+encodeURIComponent(n.id),{method:'DELETE'}).catch(()=>{});
  });
  save(); render();
};
/** Starting over: everything typed for this diff goes, so ask before dropping work that cannot be undone. */
el('clearAll').onclick=()=>{
  const n=state.notes.size;
  if(!n&&!el('general').value.trim()) return;
  const files=new Set([...state.notes.values()].map((note: any)=>note.file)).size;
  if(!confirm('Delete '+(n?n+' note'+(n===1?'':'s'):'the overall note')+' and start from scratch?'+
    (files?'\n\n'+files+(files===1?' file goes':' files go')+' back to not viewed. Files without notes keep their mark.':'')+
    (state.sessionFile?'\n\n'+state.sessionFile+' stays on disk. Use New review in settings to open a fresh one.':''))) return;
  clearNotes(); fitGeneral(); render();
};
el('general').oninput=()=>{ save(); updateCount(); };
el('reload').onclick=()=>load(true);
el('submit').onclick=async()=>{
  const general=el('general').value;
  if(!state.notes.size&&!general.trim()){ alert('Add at least one note before saving.'); return; }
  const button=el('submit');
  button.disabled=true;
  try{
    const r=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({general,comments:[...state.notes.values()],replace:!!state.cfg.single})});
    const d=await r.json();
    if(!r.ok){ alert('Could not save: '+(d.error||r.status)); return; }
    /** Notes are stamped so verdicts and replies can find their way back to them. */
    state.sessionFile=d.file;
    markSubmitted(d.file);
    save();
    // The review stays on screen: the agent works against this same page from here on. Every note
    // now has a thread to reply in, so the boxes are redrawn — from where the reader was standing.
    const pane=el('diff'), at=pane.scrollTop;
    render();
    pane.scrollTop=at;
    handover(d);
  }finally{
    button.disabled=false;
  }
};
/**
 * The page does not go anywhere on a save any more — the conversation carries on in the diff — so the
 * one thing worth saying is which file to point the agent at, and it stays until it is dismissed.
 */
function handover(d: any){
  const host=el('toasts');
  const gone=(d.removed||[]).length;
  const toast=document.createElement('div');
  toast.className='toast saved';
  toast.innerHTML='<span class="ic">'+SVG.check+'</span>'+
    '<span class="tx">Saved <code>'+esc(d.file)+'</code> — '+d.count+
    (d.count===1?' note':' notes')+(gone?', replaced '+gone+' earlier file'+(gone===1?'':'s'):'')+
    '<br><span class="sub">Ask the agent: <code>Address the notes in '+esc(d.file)+'</code></span></span>'+
    '<button class="undo" title="Copy the prompt">copy</button>';
  toast.querySelector('.undo').onclick=async()=>{
    try{ await navigator.clipboard.writeText('Address the notes in '+d.file); }catch{}
    toast.remove();
  };
  host.append(toast);
  while(host.children.length>3) host.firstElementChild.remove();
  setTimeout(()=>{ toast.classList.add('out'); setTimeout(()=>toast.remove(),200); },9000);
}
