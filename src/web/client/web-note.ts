import { mountNoteIn, openWebEditor, setWebNoteCapturing, setWebNoteError, updateWebNoteEvidence } from './notes.ts';
import { noteByRef, refIn, refOf } from './note-ref.ts';
import { state } from './state.ts';
import { webReview, type WebReview } from '../../web-review-model.ts';
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
  const tell=(action:'dirty'|'close'|'review'|'ready'|'remove-selection'|'annotation',value:{dirty?:boolean;saving?:boolean;id?:string;index?:number;key?:string;open?:boolean}={})=>
    window.parent.postMessage({type:'lcr:ui',token,action,...value},parentOrigin);
  const host=document.createElement('section');host.id='uiNote';host.setAttribute('aria-label','Review note');
  const tools=document.createElement('div');tools.className='ui-note-tools';
  const link=document.createElement('a');link.textContent='Full conversation';link.href='/';
  tools.append(link);
  const body=document.createElement('div');body.className='ui-note-body';host.append(tools,body);document.body.append(host);
  let activeId=noteId||'';
  let capturing=false,closing=false,pendingWeb: WebReview|null|undefined=undefined;
  let annotationOpen=false,annotationDirty=false;
  function dirty(){
    if(closing)return false;
    if(capturing||annotationDirty)return true;
    if(state.noteSending.size||state.noteDelivery.get(activeId)?.error)return true;
    const ta=host.querySelector<HTMLTextAreaElement>('textarea');
    if(!ta)return false;
    const original=ta.dataset.was??(ta.closest('.nedit')?state.notes.get(activeId)?.body:'')??'';
    return ta.value.trim()!==original.trim();
  }
  const changed=()=>{
    setWebNoteCapturing(body,capturing);
    tell('dirty',{dirty:dirty(),saving:!!state.noteSending.size||annotationOpen});
  };
  host.addEventListener('input',changed);
  document.addEventListener('lcr:annotation-state',event=>{
    if(!(event instanceof CustomEvent)||typeof event.detail?.open!=='boolean')return;
    annotationOpen=event.detail.open;annotationDirty=event.detail.dirty===true;
    tell('annotation',{open:annotationOpen});changed();
  });
  host.addEventListener('lcr:web-remove',event=>{
    if(!(event instanceof CustomEvent)||capturing||state.noteSending.size)return;
    capturing=true;setWebNoteError(body,activeId);changed();
    tell('remove-selection',event.detail);
  });
  new MutationObserver(changed).observe(body,{childList:true,subtree:true});
  const close=()=>{closing=true;tell('dirty',{dirty:false,saving:false});tell('close');};
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==parentOrigin)return;
    const data:unknown=event.data;
    if(!data||typeof data!=='object'||!('type' in data)||data.type!=='lcr:ui'||
      !('token' in data)||data.token!==token||!('action' in data))return;
    if(data.action==='capturing'&&'busy' in data&&typeof data.busy==='boolean'){
      capturing=data.busy;changed();
    }else if(data.action==='evidence'){
      if('error' in data&&typeof data.error==='string'){
        setWebNoteError(body,activeId,data.error);
        return;
      }
      if(!('web' in data))return;
      const web=data.web===null?null:webReview(data.web);
      if(data.web!==null&&!web)return;
      pendingWeb=web;
      setWebNoteError(body,activeId);
      if(activeId)updateWebNoteEvidence(body,activeId,web);
    }
  });
  document.addEventListener('lcr:note-saved',event=>{
    if(event instanceof CustomEvent&&event.detail===activeId)close();
  });
  document.addEventListener('lcr:notes',()=>{
    if(!noteId)return;
    const note=state.notes.get(noteId);
    if(!note){close();return;}
    updateWebNoteEvidence(body,noteId,note.web??null);
    changed();
  });
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
      const value=data&&typeof data==='object'&&'web' in data?data.web:undefined;
      const web=value===null?null:webReview(value);
      if(!response.ok||value!==null&&!web)throw new Error('This selection is no longer available. Select the page again.');
      activeId=openWebEditor(body,pendingWeb===undefined?web:pendingWeb,close);
    }else{
      const note=state.notes.get(noteId);
      if(!note)throw new Error('This note is no longer in the review.');
      mountNoteIn(body,note);
    }
    if(pendingWeb!==undefined)updateWebNoteEvidence(body,activeId,pendingWeb);
    link.href=state.notes.has(activeId)?'/#note='+encodeURIComponent(refOf(activeId)):'/';
    if(draft)link.textContent='Review';
    changed();
    tell('ready',{id:activeId});
  }catch(error){
    const message=document.createElement('p');message.className='ui-note-error';message.setAttribute('role','alert');
    message.textContent=error instanceof Error?error.message:String(error);body.append(message);
  }
}
