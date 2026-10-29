import { mountRowAt, setFolded, setHidden } from './diff-view.ts';
import { isHidden } from './filters.ts';
import { closeReader } from './reader.ts';
import { pathHtml } from './path.ts';
import { ReadingPlace, readingAt, readingPlace, readingRow, resumeOffset } from './reading-model.ts';
import { readingTracker } from './reading-tracker.ts';
import { el, esc, idxOf, state } from './state.ts';

let stopped: ReadingPlace|null=null,tracker: ReturnType<typeof readingTracker>|null=null;
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
  return readingAt(el('diff').getBoundingClientRect(),el('diff').children,path=>{
    const fi=idxOf(path),file=state.files[fi];
    return file?{fi,file}:null;
  });
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
  tracker?.cancel(); stopped=null;
  try{ localStorage.removeItem(storeKey()); }catch{}
  paintReadingPosition();
}

/** A layout rebuild and its scroll correction are not a new reading pause. */
export function pauseReadingPosition(){
  tracker?.pause(performance.now()+1000);
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
  // Fresh input always wins over layout/jump suppression; scrollbar drags have no short expiry.
  const input=()=>tracker?.input(state.jumpUntil);
  pane.addEventListener('wheel',input,{passive:true});
  pane.addEventListener('touchmove',input,{passive:true});
  pane.addEventListener('pointerdown',input,{passive:true});
  pane.addEventListener('pointermove',(e: any)=>{ if(e.buttons) input(); },{passive:true});
  document.addEventListener('keydown',(e: any)=>{
    if(!e.target.closest('textarea,input')&&['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)) input();
  });
  const remember=()=>{
    if(state.reader) return;
    const at=current(); if(!at||state.folded.has(at.file.path)) return;
    // Lazy mounting is temporary, and must never replace a real line with a file-only marker.
    if(at.index<0&&at.file.rows.length) return;
    stopped=readingPlace(at.file,at.index,at.offset);
    try{ localStorage.setItem(storeKey(),JSON.stringify(stopped)); }catch{}
    paintReadingPosition();
  };
  tracker=readingTracker(pane.scrollTop,performance.now(),remember);
  pane.addEventListener('scroll',()=>{
    tracker.scroll(pane.scrollTop,performance.now(),Number(state.cfg.limit),state.jumpUntil,
      state.reader||document.hidden);
  },{passive:true});
  const flush=()=>tracker.flush();
  window.addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',()=>{ if(document.hidden) flush(); });
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
    const target=row||el('f'+fi);
    if(target){
      const bounds=pane.getBoundingClientRect();
      const header=el('f'+fi)?.querySelector('.fh')?.getBoundingClientRect().height||0;
      const offset=row?resumeOffset(stopped.offset,header,bounds.height):0;
      pane.scrollTop+=target.getBoundingClientRect().top-bounds.top-offset;
    }
    paintReadingPosition();
  };
}
