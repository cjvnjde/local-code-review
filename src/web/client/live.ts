import { placeNotes, placeOf } from './anchor.ts';
import { mountRowAt, setFolded, setHidden } from './diff-view.ts';
import { isHidden } from './filters.ts';
import { updateCount } from './footer.ts';
import { adopt, load, render } from './load.ts';
import { save } from './persistence.ts';
import { repaintNote } from './notes.ts';
import { SVG, el, esc, idxOf, msgsOf, state } from './state.ts';
import { paintActive } from './tree.ts';

/* ---------- following the agent ---------- */
/**
 * The page keeps a connection open while the review is being worked on. Events carry no state, only
 * the news that the review file or the diff moved, and the page fetches what it needs itself — so a
 * dropped connection costs nothing that a reconnect does not fix.
 *
 * A refresh that arrives mid-sentence would rebuild the pane under an open editor, so the diff waits
 * for that editor to close. Replies never wait: they only add to a note that is already on screen.
 */

const editing=()=>!!document.querySelector('.nbox textarea');

export function startLive(){
  const source=new EventSource('/api/events');
  let connected=false;
  source.onopen=()=>{
    setLive(true);
    // Whatever moved while the connection was down was announced to nobody, so a reconnect
    // fetches instead of trusting the silence; the first open lands on a freshly loaded page.
    if(connected){ refreshReview(); checkDiffStale(); }
    connected=true;
  };
  source.onerror=()=>setLive(false); // EventSource reconnects on its own
  source.onmessage=(e: any)=>{
    let event: any=null;
    try{ event=JSON.parse(e.data); }catch{ return; }
    if(event.type==='hello'){ state.sessionFile=event.file||state.sessionFile; setLive(true); return; }
    if(event.type==='review'){ refreshReview(); return; }
    if(event.type==='diff') queueDiff();
  };
  // An editor can close in ways nothing here sees, so the wait is checked rather than subscribed to.
  setInterval(()=>{
    if(editing()) return;
    if(state.pendingDiff){ applyDiff(); return; }
    if(state.pendingNotes){ state.pendingNotes=false; placeNotes(); render(); }
  },700);
}

function setLive(on: boolean){
  state.live=on;
  const dot=el('live'); if(!dot) return;
  dot.classList.toggle('on',on);
  dot.title=on?'Following the review file and the working tree':'Not connected — reload to catch up';
}

function queueDiff(){
  if(editing()){
    state.pendingDiff=true;
    paintPending();
    return;
  }
  applyDiff();
}
async function applyDiff(){
  state.pendingDiff=false;
  state.pendingNotes=false; // the reload rebuilds the pane with every note placed
  paintPending();
  await load(true);
}

/** Compares the diff on the server with the one on screen, and only rebuilds when they differ. */
async function checkDiffStale(){
  try{
    const response=await fetch('/api/diff');
    const d=await response.json();
    if(!response.ok||d.error||!Array.isArray(d.files)) return;
    const same=d.files.length===state.files.length&&
      d.files.every((f: any,k: number)=>state.files[k].path===f.path&&state.files[k].hash===f.hash);
    if(!same) queueDiff();
  }catch{
    // The next event, or the reader's own reload, will try again.
  }
}
function paintPending(){
  const pill=el('pending'); if(!pill) return;
  pill.hidden=!state.pendingDiff;
}

/** The review file moved: take the threads and verdicts back from it and repaint what changed. */
let refreshing=false, again=false;
async function refreshReview(){
  if(refreshing){ again=true; return; }
  refreshing=true;
  try{
    const response=await fetch('/api/review');
    const data=await response.json();
    if(!response.ok) return;
    const before=new Map([...state.notes.keys()].map((id: any)=>[id,(state.msgs.get(id)||[]).length]));
    (data.statuses||[]).forEach((s: any)=>{
      if(s.id) state.status.set(s.id,s);
      if(s.key) state.statusByKey.set(s.key,s);
    });
    adopt(data);
    save();
    // A note that arrived from the file has no box yet, so the pane is rebuilt for it — but a
    // rebuild eats an open editor, so it waits for the last one to close, exactly as a diff does.
    const fresh=[...state.notes.keys()].filter((id: any)=>!before.has(id));
    if(fresh.length&&!editing()){ placeNotes(); render(); }
    else{
      if(fresh.length) state.pendingNotes=true;
      state.notes.forEach((n: any)=>repaintNote(n.id));
      updateCount();
    }
    announce(before);
  }finally{
    refreshing=false;
    if(again){ again=false; refreshReview(); }
  }
}

/** Says what the agent just wrote, and offers to take the reader to it. */
function announce(before: Map<string,number>){
  const host=el('toasts'); if(!host) return;
  state.notes.forEach((n: any)=>{
    const had=before.get(n.id);
    if(had==null) return;
    const msgs=msgsOf(n);
    const last=msgs[msgs.length-1];
    if(msgs.length<=had||!last||last.role!=='agent') return;
    const toast=document.createElement('div');
    toast.className='toast reply';
    toast.innerHTML='<span class="ic">'+SVG.check+'</span>'+
      '<span class="tx" title="'+esc(n.file)+'">'+esc(n.file.split('/').pop()+(n.label?':'+n.label:''))+'</span>'+
      '<span class="lbl">replied</span><button class="undo">show</button>';
    toast.querySelector('.undo').onclick=()=>{ jumpToNote(n.id); toast.remove(); };
    host.append(toast);
    while(host.children.length>3) host.firstElementChild.remove();
    setTimeout(()=>{ toast.classList.add('out'); setTimeout(()=>toast.remove(),200); },6000);
  });
}

el('unread').onclick=()=>{
  const next: any=[...state.notes.values()].find((n: any)=>(state.msgs.get(n.id)||[]).length>(state.seen.get(n.id)||0));
  if(next) jumpToNote(next.id);
};
/** The wait is a courtesy, not a lock: the reader can take the refresh now and lose the draft. */
el('pending').onclick=()=>{
  const ta: any=document.querySelector('.nbox textarea');
  if(ta&&ta.value.trim()&&!confirm('Refresh the diff now?\n\nThe note you are writing will be lost.')) return;
  applyDiff();
};

/** Brings one note on screen, opening whatever the reader had put away to get there. */
export function jumpToNote(id: string){
  const note=state.notes.get(id); if(!note) return;
  const place=placeOf(note);
  if(place){
    if(isHidden(note.file)) setHidden([note.file],false);
    if(state.folded.has(note.file)) setFolded(note.file,false);
    state.jumpUntil=performance.now()+500;
    if(place.i>=0) mountRowAt(place.fi,place.j);
    state.active=note.file; paintActive();
  }
  const row=[...document.querySelectorAll('.nrow')].find((n: any)=>n.dataset.nid===id);
  const target=row||el('f'+idxOf(note.file))||el('fstray');
  if(target) (target as any).scrollIntoView({block:row?'center':'start'});
  if(row) (row as any).querySelector('.nbox')?.click();
}
