import { renderDiff, setViewed } from './diff-view.ts';
import { render } from './load.ts';
import { saveCfg } from './persistence.ts';
import { SVG, el, state } from './state.ts';

/* ---------- settings ---------- */
el('gear').innerHTML=SVG.sliders;
const openSettings=(on: boolean)=>{
  el('settings').hidden=!on;
  el('gear').classList.toggle('on',on);
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

let skillData=null;
function selectedSkillTarget(){
  return skillData?.targets.find(target=>target.directory===el('skillTarget').value);
}
function renderSkillTarget(){
  const target=selectedSkillTarget();
  if(!target) return;
  el('skillPath').textContent=target.path;
  el('skillStatus').classList.toggle('warning',target.state==='replace');
  el('skillStatus').textContent=target.state==='installed'
    ?'Already installed. Destination matches preview.'
    :target.state==='replace'
      ?'Existing SKILL.md will be replaced only after confirmation.'
      :'New SKILL.md will be created only after confirmation.';
  el('confirmSkill').disabled=target.state==='installed';
  el('confirmSkill').textContent=target.state==='replace'?'Replace skill':'Install skill';
}
el('createSkill').onclick=async()=>{
  const button=el('createSkill');
  button.disabled=true; button.textContent='Loading…';
  try{
    const response=await fetch('/api/skill');
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||response.status);
    skillData=data;
    el('skillPreview').textContent=data.content;
    el('skillTarget').replaceChildren(...data.targets.map(target=>{
      const option=document.createElement('option');
      option.value=target.directory; option.textContent=target.directory;
      return option;
    }));
    renderSkillTarget();
    el('skillDialog').showModal();
  }catch(error){
    alert('Could not preview skill: '+(error instanceof Error?error.message:String(error)));
  }finally{
    button.disabled=false; button.textContent='Create skill';
  }
};
el('skillTarget').onchange=renderSkillTarget;
el('closeSkill').onclick=el('cancelSkill').onclick=()=>el('skillDialog').close();
el('confirmSkill').onclick=async()=>{
  const target=selectedSkillTarget();
  if(!target||target.state==='installed') return;
  const button=el('confirmSkill');
  button.disabled=true; button.textContent=target.state==='replace'?'Replacing…':'Installing…';
  try{
    const response=await fetch('/api/skill',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({directory:target.directory,expectedState:target.state,
        expectedRevision:target.revision,confirmationToken:skillData.confirmationToken})});
    const data=await response.json();
    if(!response.ok){
      if(response.status===403||response.status===409) el('skillDialog').close();
      throw new Error(data.error||response.status);
    }
    skillData.confirmationToken='';
    target.state='installed';
    target.path=data.path;
    renderSkillTarget();
    el('skillStatus').textContent='Installed at '+data.path;
  }catch(error){
    alert('Could not install skill: '+(error instanceof Error?error.message:String(error)));
    renderSkillTarget();
  }
};

/** Cached block heights assume the current wrap width, so a resize invalidates them. */
let resizeT=null;
window.addEventListener('resize',()=>{
  clearTimeout(resizeT);
  resizeT=setTimeout(()=>{ state.h.clear(); renderDiff(); },250);
});
