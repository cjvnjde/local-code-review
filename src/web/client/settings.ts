import { renderDiff } from './diff-view.ts';
import { saveCfg } from './persistence.ts';
import { SVG, el, state } from './state.ts';

/* ---------- settings ---------- */
el('gear').innerHTML=SVG.sliders;
el('gear').onclick=e=>{
  e.stopPropagation();
  const s=el('settings');
  s.hidden=!s.hidden;
  el('gear').classList.toggle('on',!s.hidden);
};
el('settings').addEventListener('click',e=>e.stopPropagation());
el('settings').addEventListener('change',saveCfg);
document.addEventListener('click',()=>{
  if(el('settings').hidden) return;
  el('settings').hidden=true; el('gear').classList.remove('on');
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!el('settings').hidden){ el('settings').hidden=true; el('gear').classList.remove('on'); }
});

/** Cached block heights assume the current wrap width, so a resize invalidates them. */
let resizeT=null;
window.addEventListener('resize',()=>{
  clearTimeout(resizeT);
  resizeT=setTimeout(()=>{ state.h.clear(); renderDiff(); },250);
});
