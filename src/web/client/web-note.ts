import { mountNoteIn, openWebEditor } from './notes.ts';
import { noteByRef, refIn, refOf } from './note-ref.ts';
import { state } from './state.ts';
import { webCapture } from '../../web-review-model.ts';
import { syncCfg } from './persistence.ts';

const query=new URLSearchParams(location.search);
const draft=query.get('ui-draft'),noteId=query.get('ui-note');
const token=draft||noteId||'';

/** This is the ordinary application bundle, with only one shared note box exposed to the live page. */
export function prepareWebNote(){
  state.uiEmbed=window.parent!==window&&!!token;
  document.body.classList.toggle('ui-note',state.uiEmbed);
}

export async function startWebNote(){
  if(!state.uiEmbed||!state.web)return;
  const parentOrigin=new URL(state.web.url).origin;
  const tell=(action:'dirty'|'close'|'review',value:{dirty?:boolean;id?:string}={})=>
    window.parent.postMessage({type:'lcr:ui',token,action,...value},parentOrigin);
  const host=document.createElement('section');host.id='uiNote';host.setAttribute('aria-label','Review note');
  const tools=document.createElement('div');tools.className='ui-note-tools';
  const link=document.createElement('a');link.textContent='Full conversation';link.href='/';
  tools.append(link);
  const body=document.createElement('div');body.className='ui-note-body';host.append(tools,body);document.body.append(host);
  let activeId=noteId||'';
  function dirty(){
    if(state.noteSending.size||state.noteDelivery.get(activeId)?.error)return true;
    const ta=host.querySelector<HTMLTextAreaElement>('textarea');
    if(!ta)return false;
    const original=ta.dataset.was??(ta.closest('.nedit')?state.notes.get(activeId)?.body:'')??'';
    return ta.value.trim()!==original.trim();
  }
  const changed=()=>tell('dirty',{dirty:dirty()});
  host.addEventListener('input',changed);
  new MutationObserver(changed).observe(body,{childList:true,subtree:true});
  const close=()=>{tell('dirty',{dirty:false});tell('close');};
  document.addEventListener('lcr:note-saved',event=>{
    if(event instanceof CustomEvent&&event.detail===activeId)close();
  });
  document.addEventListener('lcr:notes',()=>{if(noteId&&!state.notes.has(noteId))close();});
  // References remain ordinary note links, but their destination is the already-open full review.
  document.addEventListener('click',event=>{
    if(!(event.target instanceof Element))return;
    const target=event.target.closest<HTMLElement>('[data-nref],[data-goto],a');
    if(!target)return;
    const referenced=target.dataset.nref||target.dataset.goto;
    const ref=target instanceof HTMLAnchorElement?refIn(target.getAttribute('href')||''):'';
    if(target===link){
      event.preventDefault();event.stopImmediatePropagation();
      tell('review',state.notes.has(activeId)?{id:activeId}:{});
      return;
    }
    const id=referenced||noteByRef(ref,state.notes.values())?.id;
    if(!id)return;
    event.preventDefault();event.stopImmediatePropagation();tell('review',{id});
  },true);
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  try{
    await syncCfg();
    if(draft){
      const response=await fetch('/api/web/draft?id='+encodeURIComponent(draft));
      const data:unknown=await response.json();
      const capture=webCapture(data&&typeof data==='object'&&'capture' in data?data.capture:null);
      if(!response.ok||!capture)throw new Error('This selection is no longer available. Select the page again.');
      activeId=openWebEditor(body,{before:capture,after:[]},close);
    }else{
      const note=state.notes.get(noteId);
      if(!note)throw new Error('This note is no longer in the review.');
      mountNoteIn(body,note);
    }
    link.href=state.notes.has(activeId)?'/#note='+encodeURIComponent(refOf(activeId)):'/';
    if(draft)link.textContent='Review';
    changed();
  }catch(error){
    const message=document.createElement('p');message.className='ui-note-error';message.setAttribute('role','alert');
    message.textContent=error instanceof Error?error.message:String(error);body.append(message);
  }
}
