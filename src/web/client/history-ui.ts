import { historyMatches, historyScopeLabel, historySummary, historyText, type HistoryEntry, type HistoryNote } from './history-model.ts';
import { historyError, onHistoryChange, readHistory } from './history.ts';
import { mdHtml } from './markdown.ts';
import { pathHtml } from './path.ts';
import { el, esc } from './state.ts';
import { historyNavigation, type HistoryView } from './history-navigation.ts';

let entries: HistoryEntry[]=[], selected='', noteId='', mode:'changes'|'snapshot'='changes', limit=60;
let opened=false, request=0, returnFocus: HTMLElement|null=null;
let navigation: ReturnType<typeof historyNavigation>|null=null;
let painted='';
const detailKey=()=>JSON.stringify([selected,mode,noteId,!!entries.find(e=>e.id===selected)]);
const when=(at: number)=>new Date(at).toLocaleString([],{dateStyle:'medium',timeStyle:'medium'});
const visible=()=>entries.filter(e=>historyMatches(e,el('historySearch').value,noteId)&&
  (!el('historySource').value||e.source===el('historySource').value));

/** This overlay never unmounts a note editor or changes the working conversation. */
export function openHistory(id=''){
  const view: HistoryView={note:id,selected:'',mode,query:'',source:'',scope:el('historyScope').value,limit:60};
  if(navigation) navigation.open(view); else showHistory(view);
}
function viewState(): HistoryView{
  return {note:noteId,selected,mode,query:el('historySearch').value,source:el('historySource').value,
    scope:el('historyScope').value,limit};
}
function rememberView(){ if(opened) navigation?.update(viewState()); }
function showHistory(view: HistoryView|null){
  if(!view){ hideHistory(); return; }
  if(!opened) returnFocus=document.activeElement as HTMLElement;
  opened=true; noteId=view.note; selected=view.selected; limit=view.limit; mode=view.mode;
  el('historyPanel').hidden=false;
  el('showHistory').setAttribute('aria-expanded','true');
  el('historySearch').value=view.query; el('historySource').value=view.source;
  el('historyScope').value=view.scope;
  el('historyAll').hidden=!noteId;
  el('historySearch').focus();
  painted='';
  el('historyDetail').textContent='Loading history…';
  void refresh();
}
function closeHistory(){
  if(navigation) navigation.close(); else hideHistory();
}
function hideHistory(){
  if(!opened) return;
  opened=false; ++request;
  el('historyPanel').hidden=true;
  el('showHistory').setAttribute('aria-expanded','false');
  if(returnFocus?.isConnected) returnFocus.focus();
}
function paintError(message: string){
  el('historyMessage').textContent=message;
  el('historyMessage').hidden=!message;
}
async function refresh(){
  const token=++request;
  try{
    const result=await readHistory(el('historyScope').value==='repo');
    if(token!==request||!opened) return;
    entries=result;
    paintError(historyError()?'History could not be saved: '+historyError():'');
    paintList();
  }catch(error){
    if(token!==request||!opened) return;
    paintError('History is unavailable: '+(error instanceof Error?error.message:String(error)));
  }
}
function paintList(){
  const list=visible();
  if(!list.some(e=>e.id===selected)) selected=list[0]?.id||'';
  if(painted!==detailKey()) paintDetail();
  rememberView();
  el('historyCount').textContent=String(list.length);
  const host=el('historyList'), top=host.scrollTop;
  host.innerHTML=list.slice(0,limit).map(e=>'<button type="button" class="revision'+(e.id===selected?' on':'')+
    '" data-revision="'+esc(e.id)+'" aria-pressed="'+(e.id===selected)+'">'+
    '<time>'+esc(when(e.at))+'</time><b>'+esc(historySummary(e))+'</b>'+
    '<span>'+esc(historyScopeLabel(e.scope))+'</span><span>'+esc(e.source==='page'?'On this page':'Review file')+' · '+e.changes.length+
    (e.changes.length===1?' note':' notes')+'</span></button>').join('')||
    '<p class="history-empty">'+(entries.length?'No matching changes.':'No history yet. Saved notes and review updates will appear here.')+'</p>';
  el('historyMore').hidden=list.length<=limit;
  el('historyExport').disabled=!entries.length;
  host.scrollTop=top;
}
function safeMarkdown(body: string,path: string){
  // A historical reference retains the wording it had then, not a chip naming today's target.
  return mdHtml(body.replace(/\[([^\]]*)\]\(lcr:[^)]+\)/g,'$1'),path);
}
export function historyNoteHtml(n: HistoryNote|undefined){
  if(!n) return '<p class="history-empty">Not present</p>';
  return '<div class="history-note">'+
    (n.code?'<details class="history-capture"><summary>Captured code</summary><pre>'+esc(n.code)+'</pre></details>':'')+
    '<div class="history-question"><b>Question / note</b><div class="md">'+safeMarkdown(n.body,n.file)+'</div></div>'+
    '<p class="history-status">'+esc(n.status+(n.detail?' — '+n.detail:''))+'</p>'+
    n.messages.map(m=>'<div class="history-reply '+(m.role==='agent'?'ai':'')+'"><b>'+esc(m.role==='agent'?'AI':'You')+'</b>'+
      (m.at?'<time>'+esc(m.at)+'</time>':'')+'<div class="md">'+safeMarkdown(m.body,n.file)+'</div></div>').join('')+'</div>';
}
function noteHeading(n: HistoryNote){
  return (n.file?pathHtml(n.file):'<span>Overall note</span>')+
    (n.scope==='file'?'<span>whole file</span>':n.label?'<span>'+esc(n.label)+'</span>':'');
}
function paintDetail(){
  painted=detailKey();
  const entry=entries.find(e=>e.id===selected), host=el('historyDetail');
  el('historyMode').textContent=mode==='changes'?'Show full review':'Show changes';
  el('historyMode').disabled=!entry;
  el('historyCopy').disabled=!entry;
  if(!entry){ host.innerHTML='<p class="history-empty">Choose a change to read an earlier version.</p>'; return; }
  const changes=entry.changes.filter(c=>!noteId||c.id===noteId);
  host.innerHTML='<div class="history-meta"><b>'+esc(historySummary(entry))+'</b><time>'+esc(when(entry.at))+'</time>'+
    '<span>'+esc(entry.source==='page'?'On this page':'Review file')+'</span><span>'+esc(historyScopeLabel(entry.scope))+'</span>'+
    pathHtml(entry.snapshot.file||entry.beforeFile||'Unsaved review')+'</div>'+
    (mode==='snapshot'?entry.snapshot.notes.filter(n=>!noteId||n.id===noteId).map(n=>
      '<article class="history-card"><h3>'+noteHeading(n)+'</h3>'+historyNoteHtml(n)+'</article>').join('')||'<p class="history-empty">This version has no notes.</p>':
      changes.map(c=>'<article class="history-card"><h3>'+noteHeading((c.after||c.before)!)+
        '<span class="history-kinds">'+esc(c.kinds.join(' · '))+'</span></h3><div class="history-compare">'+
        '<section class="before"><h4>Before</h4>'+historyNoteHtml(c.before)+'</section>'+
        '<section class="after"><h4>After</h4>'+historyNoteHtml(c.after)+'</section></div></article>').join('')||
        '<p class="history-empty">The review file changed; the notes stayed the same.</p>');
  host.scrollTop=0;
}
function exportHistory(){
  const blob=new Blob([JSON.stringify({format:'lcr-history',version:1,exportedAt:new Date().toISOString(),entries},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download='lcr-history-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function startHistory(){
  navigation=historyNavigation(window.history,showHistory);
  window.addEventListener('popstate',()=>navigation?.restore());
  // Starting after /api/diff has supplied the read's identity lets a reload reopen the same view.
  navigation.restore();
  el('showHistory').onclick=()=>opened?closeHistory():openHistory();
  el('historyClose').onclick=closeHistory;
  el('historyAll').onclick=()=>{ noteId=''; el('historyAll').hidden=true; selected=''; paintList(); };
  el('historySearch').oninput=()=>{ limit=60; paintList(); };
  el('historySource').onchange=()=>{ limit=60; paintList(); };
  el('historyScope').onchange=()=>{ limit=60; selected=''; rememberView(); void refresh(); };
  el('historyMore').onclick=()=>{ limit+=60; paintList(); };
  el('historyMode').onclick=()=>{ mode=mode==='changes'?'snapshot':'changes'; paintDetail(); rememberView(); };
  el('historyExport').onclick=exportHistory;
  el('historyCopy').onclick=async()=>{
    const entry=entries.find(e=>e.id===selected); if(!entry) return;
    try{ await navigator.clipboard.writeText(historyText(entry,mode,noteId)); el('historyCopy').textContent='Copied';
      setTimeout(()=>{ el('historyCopy').textContent='Copy text'; },1500);
    }catch{ paintError('Could not copy. Select the text or export history instead.'); }
  };
  el('historyList').onclick=(event: any)=>{
    const button=event.target.closest('[data-revision]'); if(!button) return;
    selected=button.dataset.revision; paintList();
  };
  // Escape belongs to this overlay before the underlying reader/editor can handle it.
  document.addEventListener('keydown',event=>{
    if(!opened||event.key!=='Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); closeHistory();
  },true);
  el('historyPanel').addEventListener('click',(event: Event)=>event.stopPropagation());
  onHistoryChange(()=>{
    const message=historyError(), indicator=el('historyWarning');
    indicator.hidden=!message; indicator.title=message;
    if(opened) void refresh();
  });
  window.addEventListener('focus',()=>{ if(opened) void refresh(); });
}
