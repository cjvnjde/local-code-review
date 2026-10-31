import { webReview, type WebCapture } from '../../web-review-model.ts';
import { attachSrc } from './attach.ts';
import { esc } from './state.ts';
export function webCaptureHtml(value:any){
  const web=webReview(value);if(!web)return '';
  const picture=(ref:string,alt:string)=>'<a href="'+esc(attachSrc(ref))+'" target="_blank" rel="noreferrer noopener"><img loading="lazy" src="'+esc(attachSrc(ref))+'" alt="'+esc(alt)+'"></a>';
  const capture=(c:WebCapture,label:string)=>'<section class="web-observation"><div class="web-caption"><b>'+esc(label)+'</b><time>'+esc(new Date(c.at).toLocaleString())+'</time></div>'+
    picture(c.area,label+' selected area')+'<details><summary>Page screenshot</summary>'+picture(c.page,label+' page screenshot')+'</details>'+
    '<details><summary>Selection metadata</summary><pre>'+esc(JSON.stringify({...c,page:undefined,area:undefined},null,2))+'</pre></details></section>';
  return '<div class="web-capture"><div class="web-location">'+esc(web.before.title||'UI note')+'<br><span>'+esc(web.before.url)+'</span></div>'+
    '<div class="web-comparison">'+capture(web.before,'Before')+web.after.map((c,i)=>capture(c,'After '+(i+1))).join('')+'</div></div>';
}
