import { noteByRef, refOf, refToken } from './note-ref.ts';
import { pathHtml } from './path.ts';
import { esc, msgsOf, state, statusOf } from './state.ts';
import { capturedLines } from './suggest.ts';
import { codeHtml, langOf } from './highlight.ts';
import { imageCaptureHtml } from './image-capture.ts';

type Body=(host: any,body: string,path: string,base?: string[],previews?: boolean)=>void;

/** Full, read-only context. Nested references stay navigable but never recursively embed cycles. */
export function previewIn(host: any,note: any,render: Body){
  const open=!!host.querySelector('details[open]');
  host.dataset.ref=refOf(note.id);
  host.className='refpreview';
  const status=statusOf(note);
  host.innerHTML='<div class="refhead"><button type="button" class="nref" data-nref="'+esc(note.id)+'">'+
    esc(refToken(note))+' · Open note</button>'+
    (note.file?pathHtml(note.file):'<span>Overall note</span>')+
    (note.label?'<span>'+esc(note.label)+'</span>':'')+
    (status?'<span>'+esc(status.status)+'</span>':'')+'</div>'+
    '<div class="refcapture c"></div><div class="refbody"></div><div class="refreplies"></div>';
  const capture=host.querySelector('.refcapture');
  if(note.image){
    capture.innerHTML=imageCaptureHtml(note.image);
  }else if(note.code){
    const pre=document.createElement('pre');
    pre.innerHTML=note.code.split('\n').map((line: string)=>codeHtml(line,langOf(note.file))).join('\n');
    capture.append(pre);
  }else capture.remove();
  render(host.querySelector('.refbody'),note.body,note.file,capturedLines(note.code),false);
  const messages=msgsOf(note);
  if(!messages.length) return;
  const details=document.createElement('details');
  const summary=document.createElement('summary');
  summary.textContent='Show all '+messages.length+' repl'+(messages.length===1?'y':'ies');
  const thread=document.createElement('div'); thread.className='refthread';
  details.append(summary,thread);
  // Re-read the file's messages on each repaint, and draw them only when requested.
  let drawn=false;
  const draw=()=>{
    if(drawn||!details.open) return;
    drawn=true;
    messages.forEach((message: any)=>{
      const wrap=document.createElement('div'); wrap.className='refmessage';
      const who=document.createElement('b'); who.textContent=message.role==='agent'?'Agent':'You';
      const body=document.createElement('div');
      render(body,message.body,note.file,capturedLines(note.code),false);
      wrap.append(who,body); thread.append(wrap);
    });
  };
  details.addEventListener('toggle',draw);
  host.querySelector('.refreplies').append(details);
  details.open=open; draw();
}

export function appendPreviews(host: any,render: Body){
  const ids=new Set<string>();
  host.querySelectorAll('[data-nref]').forEach((chip: any)=>ids.add(chip.dataset.nref));
  ids.forEach(id=>{
    const note=state.notes.get(id); if(!note) return;
    const preview=document.createElement('aside');
    previewIn(preview,note,render); host.append(preview);
  });
}

/** Repaint references after local edits and live replies as well as the target's own boxes. */
export function watchPreviews(render: Body){
  let queued=false;
  document.addEventListener('lcr:notes',()=>{
    if(queued) return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      document.querySelectorAll('.refpreview').forEach((host: any)=>{
        const note=noteByRef(host.dataset.ref,state.notes.values());
        if(note) previewIn(host,note,render);
        else { host.textContent='Referenced note is no longer in this review.'; host.classList.add('gone'); }
      });
      // A deleted target's chip must stop promising it can navigate there.
      document.querySelectorAll('[data-nref]').forEach((chip: any)=>{
        const target=noteByRef(refOf(chip.dataset.nref),state.notes.values());
        if(!target||target.id!==chip.dataset.nref){ chip.disabled=true; chip.classList.add('gone'); }
      });
    });
  });
}
