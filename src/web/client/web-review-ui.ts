import { el, esc, state } from './state.ts';

export function configureWebReview(web:any){
  state.web=web||null;
  document.body.classList.toggle('web-review',!!web);
  if(!web)return;
  document.title='UI review · lcr';
  const title=document.querySelector('header>b');if(title)title.textContent='UI review';
  el('range').textContent=web.url;
}
export function webWelcomeHtml(){
  if(!state.web)return '';
  return '<div class="web-welcome"><div class="web-eyebrow">LIVE UI REVIEW</div><h1>Point at what should change.</h1>'+
    '<p>Browse your app, select an element or drag an area, and leave a note. Each conversation keeps its page screenshot, selected area and metadata.</p>'+
    '<div class="web-launch"><button class="primary" data-web-open>Open review browser</button><span>'+esc(state.web.url)+'</span></div>'+
    '<p class="web-browser-status" role="status">'+esc(state.web.detail)+'</p></div>';
}
export function startWebReviewUI(){
  document.addEventListener('click',async event=>{
    const button=(event.target as Element)?.closest?.('[data-web-open],[data-web-after],[data-web-focus]') as HTMLButtonElement;
    if(!button)return;
    const action=button.hasAttribute('data-web-after')?'capture':button.hasAttribute('data-web-focus')?'focus':'';
    const id=button.dataset.webAfter||button.dataset.webFocus;
    const label=button.textContent;button.disabled=true;button.textContent=action==='capture'?'Capturing…':'Opening…';
    try{
      const response=await fetch('/api/web'+(action?'/'+action:''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not reach the review browser.');
      if(!action){state.web=result;const status=document.querySelector('.web-browser-status');if(status)status.textContent=result.detail;}
    }catch(error){alert(error instanceof Error?error.message:String(error));}
    finally{button.disabled=false;button.textContent=label;}
  });
}
