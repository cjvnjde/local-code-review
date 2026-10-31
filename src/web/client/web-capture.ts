import { webReview, webSelectionKey, type WebCapture } from '../../web-review-model.ts';
import { attachSrc } from './attach.ts';
import { esc } from './state.ts';
export function webCaptureHtml(value:unknown,removable=false){
  const web=webReview(value);if(!web)return '';
  const picture=(ref:string,alt:string)=>'<a href="'+esc(attachSrc(ref))+'" target="_blank" rel="noreferrer noopener"><img loading="lazy" src="'+esc(attachSrc(ref))+'" alt="'+esc(alt)+'"></a>';
  const editablePicture=(c:WebCapture,ref:string,alt:string,index:number,kind:'selection'|'after')=>removable?
    '<button type="button" class="web-picture" data-web-annotate="'+index+'" data-web-kind="'+kind+'" data-web-key="'+esc(webSelectionKey(c))+
    '" aria-label="Draw on '+esc(alt.toLowerCase())+'"><img loading="lazy" src="'+esc(attachSrc(ref))+'" alt="'+esc(alt)+'"></button>':picture(ref,alt);
  const capture=(c:WebCapture,label:string,index:number,kind:'selection'|'after')=>'<section class="web-observation"><div class="web-caption"><b>'+esc(label)+'</b><time>'+esc(new Date(c.at).toLocaleString())+'</time>'+
    (removable?'<span class="web-caption-actions">':'')+
    (removable?'<button type="button" data-web-annotate="'+index+'" data-web-kind="'+kind+'" data-web-key="'+esc(webSelectionKey(c))+'" aria-label="'+
      (c.annotation?'Edit drawing on ':'Annotate ')+esc(label.toLowerCase())+' screenshot">'+(c.annotation?'Edit drawing':'Annotate')+'</button>':'')+
    (removable&&kind==='selection'?'<button type="button" class="danger" data-web-remove="'+index+'" data-web-key="'+esc(webSelectionKey(c))+'" aria-label="'+
      (index===0?'Remove first selection'+(web.after.length?' and its comparisons':''):'Remove selection '+(index+1))+'">Remove</button>':'')+
    (removable?'</span>':'')+'</div>'+
    (c.annotation?'<div class="web-image-label">Annotated proposal · margin is drawing space, not captured UI</div>'+editablePicture(c,c.annotation.image,label+' annotated proposal',index,kind)+
      '<details><summary>Original selected area</summary>'+editablePicture(c,c.area,label+' original selected area',index,kind)+'</details>':editablePicture(c,c.area,label+' selected area',index,kind))+
    '<details><summary>Page screenshot</summary>'+picture(c.page,label+' page screenshot')+'</details>'+
    (c.selections?'<div class="web-targets"><b>'+c.selections.length+(c.mode==='area'?' elements in area (up to 100)':' selected targets')+'</b><ol>'+c.selections.map(target=>
      '<li><code>'+esc(target.selector||target.element?.tag||c.mode)+'</code>'+
      (target.element?.text?' — '+esc(target.element.text):'')+
      (target.components.length?' <span>'+esc(target.components.map(component=>component.name).join(' → '))+'</span>':'')+
      '<pre>'+esc(JSON.stringify(target.rect))+'</pre></li>').join('')+'</ol></div>':'')+
    '<details><summary>Selection metadata</summary><pre>'+esc(JSON.stringify({...c,page:undefined,area:undefined},null,2))+'</pre></details></section>';
  return '<div class="web-capture"><div class="web-location">'+esc(web.before.title||'UI note')+'<br><span>'+esc(web.before.url)+'</span></div>'+
    '<div class="web-comparison">'+capture(web.before,'Before',0,'selection')+(web.additional??[]).map((c,i)=>capture(c,'Selection '+(i+2),i+1,'selection')).join('')+
    web.after.map((c,i)=>capture(c,'After '+(i+1),i,'after')).join('')+'</div></div>';
}
