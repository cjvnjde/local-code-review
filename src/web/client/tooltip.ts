/** Action tooltips appear on hover or keyboard focus, without the browser's native delay. */
export function watchTooltips(){
  const tip=document.createElement('div');
  tip.id='fileTooltip'; tip.className='tooltip'; tip.role='tooltip'; tip.hidden=true;
  document.body.append(tip);
  let active: HTMLElement|null=null, described: string|null=null;
  const hide=()=>{
    if(active){
      if(described===null) active.removeAttribute('aria-describedby');
      else active.setAttribute('aria-describedby',described);
    }
    active=null; tip.hidden=true;
  };
  const show=(target: HTMLElement)=>{
    if(active!==target){
      hide(); active=target; described=target.getAttribute('aria-describedby');
      target.setAttribute('aria-describedby',[described,tip.id].filter(Boolean).join(' '));
    }
    const label=target.dataset.tooltip||'';
    if(tip.textContent!==label) tip.textContent=label;
    tip.hidden=!tip.textContent;
    const box=target.getBoundingClientRect(), size=tip.getBoundingClientRect();
    const gap=parseFloat(getComputedStyle(tip).paddingLeft);
    tip.style.left=Math.max(gap,Math.min(box.left+(box.width-size.width)/2,innerWidth-size.width-gap))+'px';
    tip.style.top=(box.bottom+gap+size.height<=innerHeight?box.bottom+gap:
      Math.max(gap,box.top-size.height-gap))+'px';
  };
  const enter=(e: Event)=>{
    const target=(e.target as Element).closest<HTMLElement>('[data-tooltip]');
    if(target) show(target);
  };
  const leave=(e: Event)=>{
    if(active?.contains(e.target as Node)&&!active.contains((e as MouseEvent).relatedTarget as Node)) hide();
  };
  document.addEventListener('pointerover',enter);
  document.addEventListener('focusin',enter);
  document.addEventListener('pointerout',leave);
  document.addEventListener('focusout',leave);
  document.addEventListener('pointerdown',hide);
  document.addEventListener('scroll',hide,true);
  window.addEventListener('resize',hide);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') hide(); });
  new MutationObserver(()=>{
    if(active){ if(active.isConnected) show(active); else hide(); }
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-tooltip']});
}
