import { placeNote } from './anchor.ts';
import { load } from './load.ts';
import { span } from './notes.ts';
import { renderBody } from './thread.ts';
import { SVG, el, esc, mintNoteId, reviewTime, rowKey, state } from './state.ts';

/* ---------- ghosts: notes from the other reviews of this branch ---------- */
/**
 * A note is anchored to code, not to the diff it was written in: a remark made reviewing
 * `main..HEAD` is still about the same line when the working tree is on screen. So the notes of the
 * branch's other review files are offered here as ghosts — a dim marker on the line they anchor to,
 * a preview on hover, and nothing louder. They belong to their own conversations; the one thing a
 * ghost can do is be continued, which carries it, thread and all, into the review being written now.
 *
 * A ghost is only shown where its code demonstrably is — the anchor machinery's `exact` and `moved`.
 * A `near` guess is honest for a note the reviewer wrote and can see the history of, and misleading
 * as a bare marker from another conversation, so a ghost that cannot be placed is not shown at all.
 */

/** Ghost notes rebuilt from the server's groups, placement not yet known. */
export function setGhosts(groups: any){
  state.ghosts=[];
  (groups||[]).forEach((group: any)=>{
    (group.notes||[]).forEach((n: any)=>{
      const parts=String(n.id||'').split('|');
      state.ghosts.push({
        gid:n.id||'', origin:{file:group.file,range:group.range||''},
        file:n.file, a:parts.length>=3?parts[1]:'', b:parts.length>=3?parts[2]:'',
        side:n.side==='old'?'old':'new', start:n.start||0, end:n.end||0, label:n.label||'',
        code:n.code||'', snippet:n.snippet, ca:n.ca, cb:n.cb,
        body:n.body||'', status:n.status||'pending', detail:n.detail||'', messages:n.messages||[],
      });
    });
  });
  placeGhosts();
}

/** Where every ghost is showing, keyed by `fi:rowIndex` of its first row. Recomputed with the diff. */
export function placeGhosts(){
  const at=new Map();
  state.ghosts.forEach((g: any)=>{
    const p=placeNote(g);
    if(!p||p.i<0||(p.how!=='exact'&&p.how!=='moved')) return;
    const key=p.fi+':'+p.i;
    if(!at.has(key)) at.set(key,[]);
    at.get(key).push({g,p});
  });
  state.ghostAt=at;
}

/** Mounts the markers of one file's row range, called as its blocks come on screen. */
export function applyGhostsIn(f: any,fi: number,from: number,to: number){
  if(!state.cfg.ghosts||!state.ghostAt) return;
  state.ghostAt.forEach((entries: any[],key: string)=>{
    const [gfi,idx]=key.split(':').map(Number);
    if(gfi!==fi||idx<from||idx>=to) return;
    const tr=el('r'+fi+'-'+idx);
    if(!tr||!tr.classList.contains('r')) return;
    const cell=tr.querySelector('td.c');
    if(!cell||cell.querySelector('.ghm')) return;
    const button=document.createElement('button');
    button.className='ghm';
    button.dataset.gk=key;
    button.title=entries.length===1
      ?'A note from another review of this branch'
      :entries.length+' notes from other reviews of this branch';
    button.innerHTML=SVG.ghost+(entries.length>1?'<span class="n">'+entries.length+'</span>':'');
    button.onclick=(e: any)=>{ e.stopPropagation(); showPopover(button,key,true); };
    button.onpointerenter=()=>showPopover(button,key,false);
    button.onpointerleave=()=>scheduleHide();
    // Floated to the right edge of the code cell, so it must come before the code to sit on line one.
    cell.prepend(button);
  });
}

/* ---------- the preview ---------- */
let pinned=false, hideT: any=null, shownKey='';

function popover(){
  let pop=el('ghpop');
  if(pop) return pop;
  pop=document.createElement('div');
  pop.id='ghpop';
  pop.hidden=true;
  pop.onpointerenter=()=>clearTimeout(hideT);
  pop.onpointerleave=()=>scheduleHide();
  pop.addEventListener('click',(e: any)=>e.stopPropagation());
  document.body.append(pop);
  document.addEventListener('click',()=>hidePopover(true));
  document.addEventListener('keydown',(e: any)=>{ if(e.key==='Escape') hidePopover(true); });
  el('diff').addEventListener('scroll',()=>hidePopover(true),{passive:true});
  return pop;
}

function scheduleHide(){
  if(pinned) return;
  clearTimeout(hideT);
  hideT=setTimeout(()=>hidePopover(false),300);
}

export function hidePopover(force: boolean){
  if(pinned&&!force) return;
  clearTimeout(hideT);
  pinned=false;
  shownKey='';
  const pop=el('ghpop');
  if(pop) pop.hidden=true;
}

/** When the origin review was written, from the stamp its file name carries. */
function originLabel(origin: any){
  const at=reviewTime(origin.file);
  const when=at?new Date(at).toLocaleDateString([],{month:'short',day:'numeric'}):'';
  return origin.file+(when?' · '+when:'')+(origin.range?' · '+origin.range:'');
}

function showPopover(anchor: any,key: string,pin: boolean){
  const entries=state.ghostAt&&state.ghostAt.get(key);
  if(!entries||!entries.length) return;
  clearTimeout(hideT);
  if(shownKey===key&&!el('ghpop').hidden){ pinned=pinned||pin; return; }
  const pop=popover();
  pinned=pin;
  shownKey=key;
  pop.textContent='';
  entries.forEach((entry: any)=>{
    const {g}=entry;
    const item=document.createElement('div');
    item.className='ghitem';
    const talk=g.messages.length?'<span class="ct">'+g.messages.length+
      (g.messages.length===1?' reply':' replies')+'</span>':'';
    item.innerHTML='<div class="ghsrc"><span class="ic">'+SVG.ghost+'</span>'+
      '<span class="src" title="'+esc(g.origin.file)+'">'+esc(originLabel(g.origin))+'</span>'+
      '<span class="spacer"></span>'+talk+
      '<span class="stat '+esc(g.status)+'">'+esc(String(g.status).replace('-',' '))+'</span></div>'+
      '<div class="ghbody"></div>'+
      (g.messages.length?'<div class="ghlast"></div>':'')+
      '<div class="ghacts"><button class="primary cont">Continue in this review</button></div>';
    renderBody(item.querySelector('.ghbody'),g.body,g.file);
    // The thread's last word is the state the conversation was left in, so it rides the preview.
    if(g.messages.length){
      const last=g.messages[g.messages.length-1];
      const host=item.querySelector('.ghlast');
      host.innerHTML='<span class="who">'+(last.role==='agent'?'Agent':'You')+'</span>';
      const body=document.createElement('div'); body.className='mb';
      renderBody(body,last.body,g.file);
      host.append(body);
    }
    (item.querySelector('.cont') as any).onclick=()=>continueHere(entry,item);
    pop.append(item);
  });
  pop.hidden=false;
  place(pop,anchor);
}

/** Under the marker when there is room, above it when there is not, clamped to the pane. */
function place(pop: any,anchor: any){
  const at=anchor.getBoundingClientRect();
  const width=Math.min(480,window.innerWidth-24);
  pop.style.width=width+'px';
  pop.style.left=Math.max(12,Math.min(at.right-width,window.innerWidth-width-12))+'px';
  const below=window.innerHeight-at.bottom-12;
  pop.style.maxHeight=Math.max(180,Math.min(window.innerHeight*.6,Math.max(below,at.top-12)))+'px';
  pop.style.top='';
  pop.style.bottom='';
  if(below>=Math.min(280,pop.offsetHeight+8)) pop.style.top=(at.bottom+6)+'px';
  else pop.style.bottom=(window.innerHeight-at.top+6)+'px';
}

/**
 * Carries a ghost into the current review: a fresh note where the code is now, holding the old
 * thread. The server writes it into the session file with its provenance, which is also what stops
 * the original from being offered as a ghost beside its own continuation.
 */
async function continueHere(entry: any,item: any){
  const {g,p}=entry;
  const f=state.files[p.fi];
  if(!f){ hidePopover(true); return; }
  const sp=span(f,p.i,p.j);
  const comment: any={
    id:mintNoteId(f.path,rowKey(f.rows[p.i]),rowKey(f.rows[p.j])),
    file:f.path, body:g.body, side:sp.side, start:sp.start, end:sp.end, label:sp.label, code:sp.code,
  };
  const button=item.querySelector('.cont');
  button.disabled=true; button.textContent='Continuing…';
  try{
    const response=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({from:{file:g.origin.file,id:g.gid},comment})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
  }catch(error){
    button.disabled=false; button.textContent='Continue in this review';
    alert('Could not continue the note: '+(error instanceof Error?error.message:String(error)));
    return;
  }
  hidePopover(true);
  // The note arrives from the review file like any other; the reload also lets the ghost go.
  await load(true);
}
