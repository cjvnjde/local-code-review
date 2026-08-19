import { orderedNotes } from './anchor.ts';
import { noteSummary } from './note-list.ts';
import { insertRef, refLabel, refOf, refToken } from './note-ref.ts';
import { SVG, clip, esc, noteKey } from './state.ts';

/* ---------- picking the note a note points at ---------- */
/**
 * Writing a reference by hand would mean copying an id out of the review file, so the editor offers
 * the review instead: every other note, in the order the page reads them, narrowed as you type. What
 * it inserts is the link `note-ref.ts` defines, at the caret, because a reference is a word in the
 * note's own prose rather than a field beside it.
 *
 * One picker at a time, and it belongs to the box that opened it: it comes down on the click, the
 * key, or the scroll that says the reader has moved on, and it never writes anywhere else.
 */

/** The notes one note could point at: every note of the review except itself. */
export const refCandidates=(selfId: string)=>orderedNotes()
  .map((e: any)=>e.n).filter((n: any)=>n.id!==selfId&&!!refOf(n.id));

/** The button an editor offers, and nothing at all while the review has no other note to name. */
export const refButton=(selfId: string)=>refCandidates(selfId).length
  ?'<button class="refb" type="button" title="Point at another note in this review">'+
    SVG.ref+' reference</button>'
  :'';
/** Wires that button, wherever in the editor it was placed. */
export function wireRefButton(box: any,ta: any,selfId: string){
  const button=box.querySelector('.refb');
  if(button) button.onclick=()=>openRefPicker(button,ta,selfId);
}

let pop: any=null, target: any=null, self='', shown: any[]=[], at=-1;

function popover(){
  if(pop) return pop;
  pop=document.createElement('div');
  pop.id='refpop';
  pop.hidden=true;
  pop.innerHTML='<input class="rq" placeholder="Filter notes" spellcheck="false" aria-label="Filter notes">'+
    '<div class="rflist"></div>';
  document.body.append(pop);
  const query=pop.querySelector('.rq');
  query.addEventListener('input',()=>paint(query.value));
  query.addEventListener('keydown',(e: any)=>{
    if(e.key==='Escape'){ e.preventDefault(); close(true); return; }
    if(e.key==='Enter'){ e.preventDefault(); pick(at); return; }
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      if(shown.length) step(at+(e.key==='ArrowDown'?1:-1));
    }
  });
  pop.querySelector('.rflist').addEventListener('click',(e: any)=>{
    const row=e.target.closest('[data-rfi]');
    if(row) pick(Number(row.dataset.rfi));
  });
  pop.addEventListener('mousedown',(e: any)=>e.stopPropagation());
  document.addEventListener('mousedown',()=>close(false));
  // Capture, because it is the diff pane that scrolls rather than the page; the list itself is not that.
  document.addEventListener('scroll',(e: any)=>{ if(!pop.contains(e.target)) close(false); },true);
  return pop;
}

/** Opens the picker over `ta`, which is the box the chosen reference is written into. */
export function openRefPicker(anchor: any,ta: any,selfId: string){
  if(!refCandidates(selfId).length) return;
  target=ta; self=selfId;
  const node=popover();
  const query=node.querySelector('.rq');
  query.value='';
  paint('');
  node.hidden=false;
  place(node,anchor);
  query.focus();
}

function close(back: boolean){
  if(!pop||pop.hidden) return;
  pop.hidden=true;
  shown=[]; at=-1;
  // Calling it off puts the reader back in the sentence they were writing; a click elsewhere does not.
  if(back&&target&&target.isConnected) target.focus();
}

/** Every word of the query has to be somewhere in the note, so typing narrows rather than reorders. */
function matches(n: any,words: string[]){
  if(!words.length) return true;
  const hay=(noteKey(n)+' '+noteSummary(n.body)).toLowerCase();
  return words.every(word=>hay.includes(word));
}

function paint(query: string){
  const words=String(query||'').toLowerCase().split(/\s+/).filter(Boolean);
  shown=refCandidates(self).filter((n: any)=>matches(n,words));
  at=shown.length?0:-1;
  pop.querySelector('.rflist').innerHTML=shown.length
    ?shown.map((n: any,k: number)=>'<button class="rfitem" type="button" data-rfi="'+k+'"'+
      (k===at?' data-on="1"':'')+' title="'+esc(noteKey(n))+'">'+
      '<span class="loc">'+esc(refLabel(n))+'</span>'+
      '<span class="tx">'+esc(clip(noteSummary(n.body),64)||'—')+'</span></button>').join('')
    :'<div class="rfnone">No note matches that.</div>';
}

function step(next: number){
  at=(next+shown.length)%shown.length;
  const rows=pop.querySelectorAll('.rfitem');
  rows.forEach((row: any,k: number)=>{
    if(k===at) row.dataset.on='1';
    else delete row.dataset.on;
  });
  const row: any=rows[at];
  if(row) row.scrollIntoView({block:'nearest'});
}

function pick(k: number){
  const n=shown[k];
  if(!n) return;
  insert(refToken(n));
  close(true);
}

/** Writes the reference into the box the picker was opened from. The box grows on its own `input`
 *  listener, which assigning a value does not fire. */
function insert(token: string){
  const ta=target;
  if(!ta||!ta.isConnected) return;
  const value=String(ta.value||'');
  const from=ta.selectionStart==null?value.length:ta.selectionStart;
  const written=insertRef(value,from,ta.selectionEnd==null?from:ta.selectionEnd,token);
  ta.value=written.value;
  ta.focus();
  ta.setSelectionRange(written.caret,written.caret);
  ta.dispatchEvent(new Event('input'));
}

/** Under the button when there is room for it, above it when there is not, clamped to the window. */
function place(node: any,anchor: any){
  const box=anchor.getBoundingClientRect();
  const width=Math.min(360,window.innerWidth-24);
  node.style.width=width+'px';
  node.style.left=Math.max(12,Math.min(box.left,window.innerWidth-width-12))+'px';
  const below=window.innerHeight-box.bottom-12;
  node.style.maxHeight=Math.max(180,Math.min(window.innerHeight*.5,Math.max(below,box.top-12)))+'px';
  node.style.top='';
  node.style.bottom='';
  if(below>=Math.min(240,node.offsetHeight+8)) node.style.top=(box.bottom+6)+'px';
  else node.style.bottom=(window.innerHeight-box.top+6)+'px';
}
