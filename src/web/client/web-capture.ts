import { webReview, type WebCapture } from '../../web-review-model.ts';
import { attachSrc } from './attach.ts';
import { esc } from './state.ts';
export function webCaptureHtml(value:unknown){
  const web=webReview(value);if(!web)return '';
  const picture=(ref:string,alt:string)=>'<a href="'+esc(attachSrc(ref))+'" target="_blank" rel="noreferrer noopener"><img loading="lazy" src="'+esc(attachSrc(ref))+'" alt="'+esc(alt)+'"></a>';
  const capture=(c:WebCapture,label:string)=>'<section class="web-observation"><div class="web-caption"><b>'+esc(label)+'</b><time>'+esc(new Date(c.at).toLocaleString())+'</time></div>'+
    picture(c.area,label+' selected area')+'<details><summary>Page screenshot</summary>'+picture(c.page,label+' page screenshot')+'</details>'+
    (c.selections?'<div class="web-targets"><b>'+c.selections.length+(c.mode==='area'?' elements in area (up to 100)':' selected targets')+'</b><ol>'+c.selections.map(target=>
      '<li><code>'+esc(target.selector||target.element?.tag||c.mode)+'</code>'+
      (target.element?.text?' — '+esc(target.element.text):'')+
      (target.components.length?' <span>'+esc(target.components.map(component=>component.name).join(' → '))+'</span>':'')+
      '<pre>'+esc(JSON.stringify(target.rect))+'</pre></li>').join('')+'</ol></div>':'')+
    '<details><summary>Selection metadata</summary><pre>'+esc(JSON.stringify({...c,page:undefined,area:undefined},null,2))+'</pre></details></section>';
  return '<div class="web-capture"><div class="web-location">'+esc(web.before.title||'UI note')+'<br><span>'+esc(web.before.url)+'</span></div>'+
    '<div class="web-comparison">'+capture(web.before,'Before')+(web.additional??[]).map((c,i)=>capture(c,'Selection '+(i+2))).join('')+
    web.after.map((c,i)=>capture(c,'After '+(i+1))).join('')+'</div></div>';
}
