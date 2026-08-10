import { renderDiff, setViewed } from './diff-view.ts';
import { fitGeneral } from './footer.ts';
import { load, render } from './load.ts';
import { clearNotes, saveCfg } from './persistence.ts';
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
  const info=el('sessionInfo');
  info.textContent=state.sessionFile
    ?'This conversation is in '+state.sessionFile+'.'
    :'No review file yet — your first save opens one.';
  el('newReview').disabled=!state.sessionFile;
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
/**
 * Starts a second conversation. The file that was running keeps everything said in it, so this only
 * has to let go of it here: the notes on this page go with it, or the next save would write them
 * straight back into the new file as though nothing had been answered.
 */
el('newReview').onclick=async()=>{
  const current=state.sessionFile;
  if(!current) return;
  if(!confirm('Start a new review?\n\n'+current+' stays on disk with everything said in it. '+
    'The notes and replies on this page are cleared, and your next save opens a fresh file.')) return;
  try{
    const response=await fetch('/api/review',{method:'DELETE'});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
  }catch(error){
    alert('Could not start a new review: '+(error instanceof Error?error.message:String(error)));
    return;
  }
  state.sessionFile='';
  clearNotes();
  fitGeneral();
  await load();
  await refreshReviews();
};
/** Review files are the handover to the agent, and deleting them drops the verdicts read back from
 *  them, so ask first and then reload the diff to let those statuses go. */
el('deleteReviews').onclick=async()=>{
  const n=reviews.length;
  if(!n) return;
  if(!confirm('Delete '+n+' review file'+(n===1?'':'s')+' from '+reviewDir+'/?\n\n'+
    'Your notes stay on this page. The conversations in those files, and the statuses agents '+
    'recorded in them, are lost.')) return;
  const button=el('deleteReviews');
  button.disabled=true; button.textContent='Deleting…';
  try{
    const response=await fetch('/api/reviews',{method:'DELETE'});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
    // The conversations went with the files, so nothing on this page has a thread any more.
    state.sessionFile='';
    state.msgs.clear();
    state.seen.clear();
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
