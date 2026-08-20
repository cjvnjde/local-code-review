import { attachButton, wireAttach } from './attach.ts';
import { NOTE_MAX, autogrow } from './autogrow.ts';
import { codeHtml, langOf } from './highlight.ts';
import { editorAction } from './keys.ts';
import { mdHtml } from './markdown.ts';
import { busyEditor } from './notes.ts';
import { save } from './persistence.ts';
import { refButton, wireRefButton } from './ref-picker.ts';
import { SVG, esc, markRead, msgsOf, saveKeyHint, state } from './state.ts';
import { bodyParts, capturedLines, lineDiff } from './suggest.ts';

/* ---------- threads ---------- */
/**
 * A note is a conversation, not a one-way message. The reviewer opens it, the agent answers in the
 * review file as it works, and the reviewer can answer back. The file is the only writer of a thread:
 * a reply is posted to the server, which appends it there, and the page takes the thread back from
 * the file. Nothing on this side ever invents, rewrites, or removes a message.
 *
 * The reviewer's own messages stay the reviewer's: one can be reworded or taken back where it
 * stands, exactly as the note above it can. The agent's are read-only here, because they are its
 * account of what it did. A message is named by the stamp in its marker, so one written without a
 * stamp — an agent's, or a `**Reviewer**` line put in the file by hand — is shown and left alone.
 */

/**
 * A message body, either side's: the reviewer's note and the agent's answer are the same kind of
 * writing and are drawn by the same code. Prose is Markdown — `mdHtml` escapes it and emits only its
 * own tags, so a body that contains markup shows it rather than running it — and a suggestion block
 * is lifted out ahead of that and shown as the code it is rather than as the backticks around it.
 *
 * `base` is the code the note was written on, and a suggestion is read against it: a replacement says
 * what it takes away as well as what it puts there, which is the difference between reading a
 * proposal and guessing at it. What reaches the review file is unchanged — the block there is the
 * replacement alone, which is what an agent applies. A note that captured no lines has nothing to
 * read against, so its suggestion is shown as the code it is.
 */
export function renderBody(host: any,body: string,path: string,base?: string[]){
  host.textContent='';
  const lang=langOf(path);
  bodyParts(body||'').forEach(part=>{
    if(part.t==='text'){
      const md=document.createElement('div'); md.className='md';
      md.innerHTML=mdHtml(part.v,path);
      host.append(md);
      return;
    }
    const wrap=document.createElement('div'); wrap.className='sugb';
    const head=document.createElement('div'); head.className='sugh'; head.textContent='suggested change';
    // Coloured by the diff's own tokeniser, line by line as the diff does it; it escapes as it goes.
    if(!base||!base.length){
      const code=document.createElement('pre'); code.className='c';
      code.innerHTML=part.v.split('\n').map(line=>codeHtml(line,lang)).join('\n');
      wrap.append(head,code); host.append(wrap);
      return;
    }
    // The token styles hang off class `c`, which each line's code span carries, exactly as a capture does.
    const code=document.createElement('div'); code.className='sugc';
    code.innerHTML=lineDiff(base,part.v.split('\n')).map(line=>
      '<div class="cl '+line.t+'"><span class="cm">'+MARK[line.t]+'</span>'+
      '<span class="c">'+codeHtml(line.v,lang)+'</span></div>').join('');
    wrap.append(head,code); host.append(wrap);
  });
}
/** The gutter mark each kind of line carries, exactly as a note's captured code carries it. */
const MARK={ctx:' ',del:'-',add:'+'};

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
 * read, so the ones that arrived while the page was open can announce themselves. `done` is how a
 * message that has just been reworded or withdrawn gets the note drawn again wherever it is mounted.
 */
export function renderThread(host: any,note: any,done: ()=>void){
  const msgs=msgsOf(note), read=state.seen.get(note.id)||0;
  // Either side may propose a replacement, and both propose it for the lines the note is about.
  const base=capturedLines(note.code);
  host.textContent='';
  msgs.forEach((m: any,k: number)=>{
    const agent=m.role==='agent';
    const mine=!agent&&!!m.at; // yours to change, and named by a stamp that says which one it is
    const box=document.createElement('div');
    box.className='msg '+(agent?'a':'r')+(k>=read?' fresh':'');
    const head=document.createElement('div'); head.className='who';
    // Every message names its speaker, and the agent's carries a badge as well: in a thread that
    // reads back as one conversation, whose words these are is the thing that must not be guessed at.
    head.innerHTML=(agent?'<span class="bot">AI</span>':'')+
      '<b>'+(agent?'Agent':'You')+'</b>'+
      (k>=read?'<span class="newtag">new</span>':'')+
      (m.at?'<span class="when">'+esc(when(m.at))+'</span>':'')+
      (mine?'<button class="rewrite" title="Reword this reply where it stands">Edit</button>'+
        '<button class="danger drop" title="Take this reply back out of the review file">Delete</button>':'');
    const body=document.createElement('div'); body.className='mb';
    renderBody(body,m.body,note.file,base);
    box.append(head,body); host.append(box);
    if(!mine) return;
    head.querySelector('.rewrite').onclick=()=>editMessage(box,note,m,done);
    head.querySelector('.drop').onclick=()=>dropMessage(note,m,done);
  });
}

/**
 * Rewrites one of your own messages in the box it is shown in. What is posted is the new wording;
 * the thread comes back from the review file, so the page never edits a message into itself.
 */
function editMessage(box: any,note: any,m: any,done: ()=>void){
  if(busyEditor()) return;
  const body=box.querySelector('.mb');
  const form: any=document.createElement('div'); form.className='medit';
  form.innerHTML='<textarea></textarea>'+
    '<div class="acts"><button class="primary">Save reply</button><button class="cancel">Cancel</button>'+
    attachButton()+refButton(note.id)+
    '<span class="spacer"></span><span class="tip">'+saveKeyHint()+' save &middot; esc cancel</span></div>';
  const ta: any=form.querySelector('textarea');
  ta.value=m.body||'';
  ta.dataset.was=m.body||''; // what says the box is untouched and may step aside for the next one
  body.replaceWith(form);
  autogrow(ta,NOTE_MAX); // after the value, so a long message opens at full height
  wireRefButton(form,ta,note.id);
  wireAttach(form,ta);
  ta.focus();
  const shut=()=>form.replaceWith(body);
  form.__shut=shut;
  let sending=false;
  const commit=async()=>{
    if(sending) return;
    const text=ta.value.trim();
    // Emptying a message is withdrawing it, exactly as emptying a note deletes the note.
    if(!text){ shut(); dropMessage(note,m,done); return; }
    if(text===(m.body||'').trim()){ shut(); return; }
    sending=true;
    const button: any=form.querySelector('.primary');
    button.disabled=true; button.textContent='Saving…';
    const ok=await tell(note.id,'/api/reply',
      {method:'PUT',headers:{'content-type':'application/json'},
        body:JSON.stringify({id:note.id,at:m.at,body:text})},'save the reply');
    if(!ok){
      sending=false;
      button.disabled=false; button.textContent='Save reply';
      return;
    }
    // The editor comes down first: a note is refused a repaint while one of its boxes is being
    // typed into, so a box still standing here would refuse the redraw meant to replace it.
    shut();
    done();
  };
  form.querySelector('.primary').onclick=commit;
  form.querySelector('.cancel').onclick=shut;
  ta.onkeydown=(e: any)=>{
    const action=editorAction(e,state.cfg.enterSaves);
    if(action==='save'){ e.preventDefault(); commit(); }
    if(action==='cancel'){ e.preventDefault(); shut(); }
  };
}

/**
 * Takes one of your own messages back out of the thread. It is in the file the agent is reading and
 * may already have been answered, so it asks first, exactly as deleting a handed-over note does.
 */
async function dropMessage(note: any,m: any,done: ()=>void){
  if(!confirm('Delete this reply?\n\nIt goes out of '+(state.sessionFile||'the review file')+
    ', where the agent reads it.')) return;
  const query='id='+encodeURIComponent(note.id)+'&at='+encodeURIComponent(m.at);
  if(!await tell(note.id,'/api/reply?'+query,{method:'DELETE'},'delete the reply')) return;
  done();
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
/**
 * The same for a message opened for rewriting: one still holding exactly what it was opened with has
 * said nothing yet, so it steps aside rather than keeping the floor. A box is drawn from the note it
 * belongs to, so it is enough to take it down — the message under it is unchanged and comes back
 * with the next draw.
 */
export function dropCleanEdit(){
  const ta: any=document.querySelector('.medit textarea');
  if(!ta||ta.value!==ta.dataset.was) return;
  const form: any=ta.closest('.medit');
  form.__shut?.();
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
    attachButton()+refButton(id)+
    '<span class="spacer"></span><span class="tip">'+saveKeyHint()+' send &middot; esc cancel</span></div>';
  const ta: any=box.querySelector('textarea');
  ta.dataset.nid=id;
  wrap.replaceWith(box);
  autogrow(ta,NOTE_MAX);
  wireRefButton(box,ta,id);
  wireAttach(box,ta);
  ta.focus();
  const shut=()=>box.replaceWith(replyButton(id,done));
  // The button disables itself, but enter still reaches the textarea mid-flight: one send at a time,
  // or a quick double enter would append the same message to the review file twice.
  let sending=false;
  const send=async()=>{
    if(sending) return;
    const body=ta.value.trim();
    if(!body){ shut(); return; }
    sending=true;
    const button: any=box.querySelector('.primary');
    button.disabled=true; button.textContent='Sending…';
    const ok=await tell(id,'/api/reply',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,body})},
      'send the reply');
    if(!ok){
      sending=false;
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

/**
 * Hands a change to a thread to the server, which writes it into the review file the agent is
 * reading, and takes the thread back from what the file then holds. Sending, rewording, and
 * withdrawing all go this way, because all three are the same thing: the file said something else,
 * and the page reads it again rather than guessing what it now says.
 */
async function tell(id: string,url: string,init: any,what: string){
  try{
    const response=await fetch(url,init);
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
    setThread(id,data.note&&data.note.messages);
    const note=state.notes.get(id);
    if(note) markRead(note); // your own message is not news to you
    save();
    return true;
  }catch(error){
    alert('Could not '+what+': '+(error instanceof Error?error.message:String(error)));
    return false;
  }
}

/** Replaces one note's thread with what the review file now holds. */
export function setThread(id: string,messages: any){
  state.msgs.set(id,Array.isArray(messages)?messages:[]);
}
