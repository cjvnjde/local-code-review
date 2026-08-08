import { renderDiff, setViewed } from './diff-view.ts';
import { load, render } from './load.ts';
import { saveCfg } from './persistence.ts';
import { SVG, el, state } from './state.ts';

/* ---------- settings ---------- */
el('gear').innerHTML=SVG.sliders;
const openSettings=(on: boolean)=>{
  el('settings').hidden=!on;
  el('gear').classList.toggle('on',on);
  // The directory is written to from outside the page, so the count is only true while it is on show.
  if(on) refreshReviews();
};
el('gear').onclick=e=>{
  e.stopPropagation();
  openSettings(el('settings').hidden);
};
el('settings').addEventListener('click',e=>e.stopPropagation());
el('settings').addEventListener('change',()=>{ if(saveCfg()) render(); });
/** Patterns are typed, not toggled, so apply them as they settle instead of on blur. */
let hideT=null;
el('cfgHide').oninput=()=>{
  clearTimeout(hideT);
  hideT=setTimeout(()=>{ if(saveCfg()) render(); },300);
};
el('fstat').onclick=e=>{ e.stopPropagation(); openSettings(true); el('cfgHide').focus(); };
document.addEventListener('click',()=>{
  if(!el('settings').hidden) openSettings(false);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!el('settings').hidden) openSettings(false);
});

/** Viewed marks are progress, not content: clearing them starts the read-through over. Routed through
 *  setViewed, so folds, stale badges and the auto-mark tracker unwind with the marks themselves. */
el('resetViewed').onclick=()=>{
  const paths=[...state.viewed.keys()];
  if(!paths.length) return;
  if(!confirm('Mark '+paths.length+' viewed file'+(paths.length===1?'':'s')+' as not viewed?')) return;
  setViewed(paths,false);
};

/** Saved review files, as the server last reported them; the delete button is labelled from this. */
let reviews=[], reviewDir='the output directory';
function renderReviews(){
  const n=reviews.length, button=el('deleteReviews');
  button.disabled=!n;
  button.textContent=n?'Delete '+n+' review file'+(n===1?'':'s'):'Delete review files';
  button.title=n?'Delete every review file in '+reviewDir+'/':'No review file has been saved yet';
}
async function refreshReviews(){
  try{
    const response=await fetch('/api/reviews');
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
    reviews=data.files||[]; reviewDir=data.dir||reviewDir;
  }catch(error){
    reviews=[];
  }
  renderReviews();
}
/** Review files are the handover to the agent, and deleting them drops the verdicts read back from
 *  them, so ask first and then reload the diff to let those statuses go. */
el('deleteReviews').onclick=async()=>{
  const n=reviews.length;
  if(!n) return;
  if(!confirm('Delete '+n+' review file'+(n===1?'':'s')+' from '+reviewDir+'/?\n\n'+
    'Your notes stay on this page. Statuses agents recorded in those files are lost.')) return;
  const button=el('deleteReviews');
  button.disabled=true; button.textContent='Deleting…';
  try{
    const response=await fetch('/api/reviews',{method:'DELETE'});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
    await refreshReviews();
    await load();
  }catch(error){
    alert('Could not delete review files: '+(error instanceof Error?error.message:String(error)));
    await refreshReviews();
  }
};

const skillCommand=el('skillCommand');
skillCommand.onclick=()=>skillCommand.select();
el('copySkillCommand').onclick=async()=>{
  const button=el('copySkillCommand');
  let copied=false;
  try{
    await navigator.clipboard.writeText(skillCommand.value);
    copied=true;
  }catch{
    skillCommand.select();
    copied=document.execCommand('copy');
  }
  if(!copied){
    alert('Could not copy command. Select the command and copy it manually.');
    return;
  }
  button.textContent='Copied';
  setTimeout(()=>{ button.textContent='Copy'; },1500);
};

/** Cached block heights assume the current wrap width, so a resize invalidates them. */
let resizeT=null;
window.addEventListener('resize',()=>{
  clearTimeout(resizeT);
  resizeT=setTimeout(()=>{ state.h.clear(); renderDiff(); },250);
});
