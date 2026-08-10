import { NOTE_MAX, autogrow } from './autogrow.ts';
import { codeHtml, langOf } from './highlight.ts';
import { editorAction } from './keys.ts';
import { save } from './persistence.ts';
import { SVG, esc, markRead, msgsOf, saveKeyHint, state } from './state.ts';
import { bodyParts } from './suggest.ts';

/* ---------- threads ---------- */
/**
 * A note is a conversation, not a one-way message. The reviewer opens it, the agent answers in the
 * review file as it works, and the reviewer can answer back. The file is the only writer of a thread:
 * a reply is posted to the server, which appends it there, and the page takes the thread back from
 * the file. Nothing on this side ever invents a message.
 */

/** A saved note reads as it was typed, except that a suggestion block is shown as the code it is
 *  rather than as the backticks around it. Prose goes in as text: a note is never markup. */
export function renderBody(host: any,body: string,path: string){
  host.textContent='';
  const lang=langOf(path);
  bodyParts(body||'').forEach(part=>{
    if(part.t==='text'){ host.append(document.createTextNode(part.v)); return; }
    const wrap=document.createElement('div'); wrap.className='sugb';
    const head=document.createElement('div'); head.className='sugh'; head.textContent='suggested change';
    // Coloured by the diff's own tokeniser, line by line as the diff does it; it escapes as it goes.
    const code=document.createElement('pre'); code.className='c';
    code.innerHTML=part.v.split('\n').map(line=>codeHtml(line,lang)).join('\n');
    wrap.append(head,code); host.append(wrap);
  });
}

/** Clock time for a message written today, and the date as well for an older one. */
function when(at: string){
  const t=Date.parse(at||'');
  if(!t) return '';
  const d=new Date(t), now=new Date();
  const time=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toDateString()===now.toDateString()?time:d.toLocaleDateString([],{month:'short',day:'numeric'})+' '+time;
}

/**
 * Draws the thread under a note's own text. `from` is how many messages the reviewer has already
 * read, so the ones that arrived while the page was open can announce themselves.
 */
export function renderThread(host: any,note: any){
  const msgs=msgsOf(note), read=state.seen.get(note.id)||0;
  host.textContent='';
  msgs.forEach((m: any,k: number)=>{
    const agent=m.role==='agent';
    const box=document.createElement('div');
    box.className='msg '+(agent?'a':'r')+(k>=read?' fresh':'');
    const head=document.createElement('div'); head.className='who';
    // Every message names its speaker, and the agent's carries a badge as well: in a thread that
    // reads back as one conversation, whose words these are is the thing that must not be guessed at.
    head.innerHTML=(agent?'<span class="bot">AI</span>':'')+
      '<b>'+(agent?'Agent':'You')+'</b>'+
      (k>=read?'<span class="newtag">new</span>':'')+
      (m.at?'<span class="when">'+esc(when(m.at))+'</span>':'');
    const body=document.createElement('div'); body.className='mb';
    renderBody(body,m.body,note.file);
    box.append(head,body); host.append(box);
  });
}

/** The reply box standing open anywhere on the page, if there is one. */
const openReply=()=>document.querySelector('.reply textarea');
/**
 * An untouched reply box is disposable, exactly as an untouched note draft is: it must not be what
 * stops the next note from being written.
 */
export function dropEmptyReply(){
  const ta: any=openReply();
  if(!ta||ta.value.trim()) return;
  const box=ta.closest('.reply');
  box.replaceWith(replyButton(ta.dataset.nid||'',(box as any).__done||(()=>{})));
}

function replyButton(id: string,done: ()=>void){
  const wrap: any=document.createElement('div'); wrap.className='reply shut';
  const button=document.createElement('button'); button.className='rbtn';
  button.innerHTML=SVG.plus+' Reply';
  button.title='Answer the agent in this note’s thread';
  button.onclick=()=>startReply(wrap,id,done);
  wrap.append(button);
  return wrap;
}

/** Mounts the reply affordance for a note that the agent can actually see: one that was handed over. */
export function mountReply(host: any,note: any,done: ()=>void){
  host.textContent='';
  if(!note.sentAt){
    const hint=document.createElement('div'); hint.className='rhint';
    hint.textContent='Save the review to start a thread on this note.';
    host.append(hint);
    return;
  }
  host.append(replyButton(note.id,done));
}

function startReply(wrap: any,id: string,done: ()=>void){
  const box: any=document.createElement('div'); box.className='reply';
  box.__done=done;
  box.innerHTML='<textarea placeholder="Reply to the agent"></textarea>'+
    '<div class="acts"><button class="primary">Send reply</button><button class="cancel">Cancel</button>'+
    '<span class="spacer"></span><span class="tip">'+saveKeyHint()+' send &middot; esc cancel</span></div>';
  const ta: any=box.querySelector('textarea');
  ta.dataset.nid=id;
  wrap.replaceWith(box);
  autogrow(ta,NOTE_MAX);
  ta.focus();
  const shut=()=>box.replaceWith(replyButton(id,done));
  const send=async()=>{
    const body=ta.value.trim();
    if(!body){ shut(); return; }
    const button: any=box.querySelector('.primary');
    button.disabled=true; button.textContent='Sending…';
    const ok=await postReply(id,body);
    if(!ok){
      button.disabled=false; button.textContent='Send reply';
      return;
    }
    // The editor comes down first. Redrawing a note is refused while one of its boxes is being typed
    // into — that is what keeps a live update from eating a half-written reply — so a box still
    // standing here would refuse the very redraw that is meant to replace it.
    shut();
    done();
  };
  box.querySelector('.primary').onclick=send;
  box.querySelector('.cancel').onclick=shut;
  ta.onkeydown=(e: any)=>{
    const action=editorAction(e,state.cfg.enterSaves);
    if(action==='save'){ e.preventDefault(); send(); }
    if(action==='cancel'){ e.preventDefault(); shut(); }
  };
}

/** Hands the reply to the server, which appends it to the review file the agent is reading. */
async function postReply(id: string,body: string){
  try{
    const response=await fetch('/api/reply',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({id,body})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
    setThread(id,data.note&&data.note.messages);
    const note=state.notes.get(id);
    if(note) markRead(note); // your own message is not news to you
    save();
    return true;
  }catch(error){
    alert('Could not send the reply: '+(error instanceof Error?error.message:String(error)));
    return false;
  }
}

/** Replaces one note's thread with what the review file now holds. */
export function setThread(id: string,messages: any){
  state.msgs.set(id,Array.isArray(messages)?messages:[]);
}
