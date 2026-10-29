import { mountRowAt, setFolded, setHidden } from './diff-view.ts';
import { isHidden } from './filters.ts';
import { closeReader } from './reader.ts';
import { pathHtml } from './path.ts';
import { ReadingPlace, readingPlace, readingRow, scrollVelocity, settleDelay } from './reading-model.ts';
import { el, esc, idxOf, state } from './state.ts';

let stopped: ReadingPlace|null=null, timer: any=null,blockedUntil=0;
let currentLabel='',resumeLabel='';
const resolved=new WeakMap<object,{place: ReadingPlace,rows: any,count: number,index: number}>();
function rowOf(file: any,place: ReadingPlace){
  const cached=resolved.get(file);
  if(cached?.place===place&&cached.rows===file.rows&&cached.count===file.rows.length) return cached.index;
  const index=readingRow(file,place);
  resolved.set(file,{place,rows:file.rows,count:file.rows.length,index});
  return index;
}
const storeKey=()=>'gitreview:position:'+state.repo+':'+(state.reviewId?'#'+state.reviewId:state.range);

/** The first code row below the sticky file header is the conservative place to resume. */
function current(){
  const fi=idxOf(state.active), file=state.files[fi], card=el('f'+fi);
  if(!file||!card) return null;
  const pane=el('diff').getBoundingClientRect();
  const head=card.querySelector('.fh')?.getBoundingClientRect();
  const top=Math.max(pane.top,head?.bottom||pane.top);
  const row=[...card.querySelectorAll('tr.r')].find((row: any)=>{
    const rect=row.getBoundingClientRect();
    return rect.bottom>top&&rect.top<pane.bottom;
  }) as any;
  return {fi,file,index:row?Number(row.dataset.i):-1};
}

export function paintReadingPosition(){
  const host=el('readingNow'); if(!host) return;
  const at=current();
  host.hidden=!at;
  if(at){
    const row=at.file.rows[at.index];
    const html='<span>Reading '+(at.fi+1)+'/'+state.files.length+'</span>'+pathHtml(at.file.path)+
      (row?'<span>'+(row.n!=null?'L'+row.n:'old L'+row.o)+'</span>':'');
    if(html!==currentLabel){ host.innerHTML=html; currentLabel=html; }
  }
  const resume=el('resumeReading');
  resume.hidden=!stopped;
  if(stopped){
    const fi=idxOf(stopped.path), file=state.files[fi];
    const index=file?rowOf(file,stopped):-1;
    resume.disabled=!file;
    const html='<span>Resume</span>'+pathHtml(stopped.path)+
      '<span>'+esc(index>=0?(file.rows[index].n!=null?'L'+file.rows[index].n:'old L'+file.rows[index].o):
        file?'file changed':'not in diff')+'</span>';
    if(html!==resumeLabel){ resume.innerHTML=html; resumeLabel=html; }
    resume.title='Last reading pause · '+new Date(stopped.at).toLocaleString()+
      (index<0?' · The original line is unavailable; resume at the file header':'');
  }
  const marked=el('diff').querySelector('.reading-stop');
  const fi=stopped?idxOf(stopped.path):-1, file=state.files[fi];
  const index=file&&stopped?rowOf(file,stopped):-1;
  const target=index>=0?el('r'+fi+'-'+index):null;
  if(marked!==target){ marked?.classList.remove('reading-stop'); target?.classList.add('reading-stop'); }
}

export function resetReadingPosition(){
  clearTimeout(timer); stopped=null;
  try{ localStorage.removeItem(storeKey()); }catch{}
  paintReadingPosition();
}

/** A layout rebuild and its scroll correction are not a new reading pause. */
export function pauseReadingPosition(){
  clearTimeout(timer);
  blockedUntil=performance.now()+1000;
}

/** Position is a display preference, separate from notes, viewed marks and the history journal. */
export function startReadingPosition(){
  try{
    const value=JSON.parse(localStorage.getItem(storeKey())||'null');
    if(value&&typeof value.path==='string'&&typeof value.anchor==='string'&&
      typeof value.hash==='string'&&typeof value.text==='string'&&Number.isFinite(value.at)) stopped=value;
  }catch{}
  paintReadingPosition();
  const pane=el('diff');
  let lastY=pane.scrollTop,lastAt=performance.now(),speed=0,manualUntil=0;
  const input=()=>{ manualUntil=performance.now()+3500; };
  pane.addEventListener('wheel',input,{passive:true});
  pane.addEventListener('touchmove',input,{passive:true});
  pane.addEventListener('pointerdown',input,{passive:true});
  pane.addEventListener('pointermove',(e: any)=>{ if(e.buttons) input(); },{passive:true});
  document.addEventListener('keydown',(e: any)=>{
    if(!e.target.closest('textarea,input')&&['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)) input();
  });
  pane.addEventListener('scroll',()=>{
    const now=performance.now(),dt=now-lastAt;
    speed=scrollVelocity(pane.scrollTop-lastY,dt);
    lastY=pane.scrollTop; lastAt=now;
    clearTimeout(timer);
    if(now<Math.max(state.jumpUntil,blockedUntil)||now>manualUntil||state.reader) return;
    timer=setTimeout(()=>{
      if(document.hidden||state.reader||document.querySelector('.nbox textarea')) return;
      const at=current(); if(!at||state.folded.has(at.file.path)) return;
      stopped=readingPlace(at.file,at.index);
      try{ localStorage.setItem(storeKey(),JSON.stringify(stopped)); }catch{}
      paintReadingPosition();
    },settleDelay(speed,Number(state.cfg.limit)));
  },{passive:true});
  el('resumeReading').onclick=()=>{
    if(!stopped||!closeReader()) return;
    const fi=idxOf(stopped.path),file=state.files[fi]; if(!file) return;
    // Rebuilding a file while its editor is open would discard the draft.
    const editor: any=document.querySelector('.nbox textarea');
    if(editor){ editor.scrollIntoView({block:'nearest'}); editor.focus(); return; }
    state.jumpUntil=performance.now()+1000;
    if(isHidden(file.path)) setHidden([file.path],false);
    if(state.folded.has(file.path)) setFolded(file.path,false);
    const index=rowOf(file,stopped);
    const row=index>=0?mountRowAt(fi,index):null;
    (row||el('f'+fi))?.scrollIntoView({block:'center'});
    paintReadingPosition();
  };
}
