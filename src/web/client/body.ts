import { codeHtml, langOf } from './highlight.ts';
import { mdHtml } from './markdown.ts';
import { appendPreviews } from './ref-preview.ts';
import { bodyParts, lineDiff } from './suggest.ts';

/** Shared read-only rendering for notes, replies and previews. Suggestions compare against captured code. */
export function renderBody(host: HTMLElement,body: string,path: string,base?: string[],previews=true){
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
    if(!base||!base.length){
      const code=document.createElement('pre'); code.className='c';
      code.innerHTML=part.v.split('\n').map(line=>codeHtml(line,lang)).join('\n');
      wrap.append(head,code); host.append(wrap);
      return;
    }
    const code=document.createElement('div'); code.className='sugc';
    code.innerHTML=lineDiff(base,part.v.split('\n')).map(line=>
      '<div class="cl '+line.t+'"><span class="cm">'+MARK[line.t]+'</span>'+
      '<span class="c">'+codeHtml(line.v,lang)+'</span></div>').join('');
    wrap.append(head,code); host.append(wrap);
  });
  // The renderer is passed in so nested references need no controller import or recursive previews.
  if(previews) appendPreviews(host,renderBody);
}

const MARK={ctx:' ',del:'-',add:'+'};
