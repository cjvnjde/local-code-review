import { mountRowAt, setFolded, setHidden } from './diff-view.ts';
import { jumpToNote } from './live.ts';
import { closeReader } from './reader.ts';
import { pathHtml } from './path.ts';
import { el, esc, idxOf, keyIndex, state, statusOf, visibleNotes } from './state.ts';
import { paintActive } from './tree.ts';
import { searchDocuments, searchExcerpt, searchHtml, searchReview, searchSegments,
  type SearchKind, type SearchResult } from './search-model.ts';

let results:SearchResult[]=[], query='', opened=false, active=-1, limit=60, filter='all';
let timer:ReturnType<typeof setTimeout>, highlighting:ReturnType<typeof setTimeout>;
let documents:ReturnType<typeof searchDocuments>|null=null;
const kinds:Record<string,string>={all:'All',file:'Files',code:'Code',note:'Notes',reply:'Replies'};
const visible=()=>results.filter(r=>filter==='all'||r.kind===filter);
const input=()=>el('reviewSearch') as HTMLInputElement;

function collect(){
  if(documents) return documents;
  const notes=visibleNotes();
  const statuses=new Map(notes.map(n=>[n.id,statusOf(n)]));
  return documents=searchDocuments(state.files,notes,state.msgs,statuses);
}
function resultHtml(r:SearchResult,k:number,detail=false){
  const text=detail?(r.kind==='code'?r.context||r.text:r.text):searchExcerpt(r.text,query,160);
  return '<button type="button" class="search-result" data-search-result="'+k+'"'+
    (!detail?' role="option" id="search-option-'+k+'" aria-selected="'+(k===active)+'"':'')+'>'+
    '<span class="search-location">'+(r.path?pathHtml(r.path):'<span>Overall review</span>')+
    '<span class="search-kind">'+esc(r.label+(r.location?' · '+r.location:''))+'</span></span>'+
    '<span class="search-preview'+(r.kind==='code'?' code':'')+'">'+searchHtml(text,query)+'</span></button>';
}
function closePopup(){
  el('searchPopup').hidden=true; input().setAttribute('aria-expanded','false');
  input().removeAttribute('aria-activedescendant'); active=-1;
}
function paintPopup(){
  if(opened||document.activeElement!==input()||!query){ closePopup(); return; }
  const shown=results.slice(0,8);
  el('searchSuggestions').innerHTML=shown.map((r,k)=>resultHtml(r,k)).join('')||
    '<p class="search-empty">No matches in this review.</p>';
  el('searchSeeAll').textContent='See all '+results.length+' results ↵';
  el('searchPopup').hidden=false; input().setAttribute('aria-expanded','true');
}
function paintPanel(reset=false){
  if(!opened) return;
  const list=visible(), body=el('searchResults'), top=reset?0:body.scrollTop;
  el('searchTitle').textContent=query?'Results for “'+query+'”':'Search this review';
  el('searchCount').textContent=results.length+' results';
  el('searchFilters').innerHTML=Object.entries(kinds).map(([kind,label])=>
    '<button type="button" data-search-kind="'+kind+'" aria-pressed="'+(kind===filter)+'">'+label+
    ' <span>'+ (kind==='all'?results.length:results.filter(r=>r.kind===kind).length)+'</span></button>').join('');
  body.innerHTML=list.slice(0,limit).map(r=>resultHtml(r,results.indexOf(r),true)).join('')||
    '<p class="search-empty">'+(query?'No matches. Try another word or filename.':'Type in the search field above to find code, files, notes and answers.')+'</p>';
  if(list.length>limit) body.insertAdjacentHTML('beforeend','<button type="button" id="searchMore">Show more results ('+(list.length-limit)+' remaining)</button>');
  body.scrollTop=top;
}
function refresh(reset=false){
  clearTimeout(timer);
  query=input().value.trim(); active=-1;
  results=searchReview(collect(),query);
  if(reset) limit=60;
  paintPopup(); paintPanel(reset); highlight();
}
function openPanel(){
  opened=true; filter='all'; limit=60;
  el('searchPanel').hidden=false; closePopup(); refresh(true);
  el('searchResults').focus();
}
function closePanel(focus=true){
  opened=false; el('searchPanel').hidden=true;
  if(focus) input().focus();
  closePopup();
}

/** Native highlight ranges leave syntax spans, note links and selection anchors intact. */
function highlight(){
  const api=(globalThis.CSS as any)?.highlights, Highlight=(globalThis as any).Highlight;
  if(!api||!Highlight) return;
  const ranges:Range[]=[];
  if(query) for(const root of [el('diff'),el('reader'),el('searchPopup'),el('searchPanel')]){
    const blocks=root.querySelectorAll('.c,.md,.pth,.stat,.search-location>span:not(.pth)');
    for(const block of blocks){
      // A Markdown code container may itself carry .c; its parent already includes that text.
      if(block.parentElement.closest('.c,.md')) continue;
      const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT), nodes:Node[]=[];
      let node:Node|null;
      while((node=walker.nextNode())) nodes.push(node);
      for(const {start,end} of searchSegments(nodes.map(n=>n.textContent||''),query)){
        const range=document.createRange();
        range.setStart(nodes[start.part],start.offset); range.setEnd(nodes[end.part],end.offset); ranges.push(range);
      }
    }
  }
  const matches=new Highlight();
  ranges.forEach(range=>matches.add(range));
  api.set('review-search',matches);
}
function navigate(k:number){
  if(query!==input().value.trim()){ refresh(); return; }
  const r=results[k]; if(!r||!closeReader()) return;
  if(!el('historyPanel').hidden) el('historyClose').click();
  closePanel(false); closePopup(); input().blur();
  if(r.noteId){
    jumpToNote(r.noteId);
    const row=[...el('diff').querySelectorAll('.nrow')].find((n:any)=>n.dataset.nid===r.noteId) as HTMLElement;
    if(r.label==='Captured code') row?.querySelector('.cap')?.classList.add('open');
    const target=r.message!=null?row?.querySelectorAll('.msg')[r.message]
      :r.label==='Captured code'?row?.querySelector('.cap'):r.label==='Status'?row?.querySelector('.nstat,.stat'):row?.querySelector('.nbody')||row;
    if(target) target.scrollIntoView({block:'center'});
  }else{
    const fi=idxOf(r.path); if(fi<0) return;
    setHidden([r.path],false);
    if(state.folded.has(r.path)) setFolded(r.path,false);
    state.jumpUntil=performance.now()+500;
    const at=r.row?keyIndex(state.files[fi]).get(r.row):null;
    const target=at!=null?mountRowAt(fi,at):el('f'+fi);
    target?.scrollIntoView({block:at!=null?'center':'start'});
    state.active=r.path; paintActive();
  }
  requestAnimationFrame(highlight);
}
function step(dir:number){
  if(opened) return;
  if(query!==input().value.trim()) refresh();
  if(el('searchPopup').hidden) paintPopup();
  const count=Math.min(8,results.length); if(!count) return;
  active=active<0?(dir>0?0:count-1):(active+dir+count)%count;
  el('searchSuggestions').querySelectorAll('[data-search-result]').forEach((node:HTMLElement,k:number)=>{
    node.setAttribute('aria-selected',String(k===active));
  });
  input().setAttribute('aria-activedescendant','search-option-'+active);
  el('search-option-'+active)?.scrollIntoView({block:'nearest'});
}

export function startSearch(){
  // Bun's CSS parser does not recognize this browser-supported selector yet. Install only this
  // rule in the browser, beside the native highlight API it styles, so bundling stays warning-free.
  if((globalThis.CSS as any)?.highlights){
    const style=document.createElement('style');
    style.textContent='::highlight(review-search){background:var(--mark);color:var(--crust)}';
    document.head.append(style);
  }
  input().addEventListener('input',()=>{
    active=-1; input().removeAttribute('aria-activedescendant');
    clearTimeout(timer); timer=setTimeout(()=>refresh(true),100);
  });
  input().addEventListener('focus',()=>refresh());
  input().addEventListener('keydown',e=>{
    if(e.isComposing) return;
    if(e.key==='Enter'){ e.preventDefault(); if(active>=0) navigate(active); else openPanel(); }
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); step(e.key==='ArrowDown'?1:-1); }
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); if(opened) closePanel(); else{ closePopup(); input().blur(); } }
  });
  el('searchSeeAll').onclick=openPanel;
  el('searchClose').onclick=()=>closePanel();
  el('searchFilters').onclick=(e:MouseEvent)=>{
    const button=(e.target as HTMLElement).closest<HTMLElement>('[data-search-kind]');
    if(button){ filter=button.dataset.searchKind as SearchKind; limit=60; paintPanel(true); }
  };
  for(const root of [el('searchSuggestions'),el('searchResults')]) root.addEventListener('click',(e:MouseEvent)=>{
    const node=(e.target as HTMLElement).closest<HTMLElement>('[data-search-result]');
    if(node) navigate(Number(node.dataset.searchResult));
    else if((e.target as HTMLElement).id==='searchMore'){ limit+=60; paintPanel(); }
  });
  document.addEventListener('pointerdown',e=>{
    if(!(e.target as HTMLElement).closest('#reviewSearchBox')) closePopup();
  });
  input().addEventListener('blur',()=>{
    // A click on a preview needs to reach its button before the popup goes away.
    setTimeout(()=>{ if(!el('reviewSearchBox').contains(document.activeElement)) closePopup(); },0);
  });
  // Capture Escape before underlying overlays; opening search never destroys their editors.
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){
      e.preventDefault(); input().focus(); input().select(); return;
    }
    if(e.key==='Escape'&&(opened||!el('searchPopup').hidden)){
      e.preventDefault(); e.stopImmediatePropagation();
      if(opened) closePanel(); else{ closePopup(); input().blur(); }
    }
  },true);
  document.addEventListener('lcr:search-change',()=>{
    documents=null;
    if(!input().value.trim()) return;
    clearTimeout(timer); timer=setTimeout(()=>refresh(),100);
  });
  // Lazily mounted code and live replies receive the same highlight as existing rows.
  const observer=new MutationObserver(()=>{
    if(!query) return;
    clearTimeout(highlighting); highlighting=setTimeout(highlight,80);
  });
  for(const root of [el('diff'),el('reader'),el('searchPopup'),el('searchPanel')])
    observer.observe(root,{childList:true,subtree:true,characterData:true});
}
