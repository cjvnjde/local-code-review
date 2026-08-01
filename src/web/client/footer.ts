import { load } from './load.ts';
import { save } from './persistence.ts';
import { el, state } from './state.ts';

/* ---------- footer ---------- */
export function updateCount(){
  const n=state.notes.size, hid=state.hidden.size, seen=state.viewed.size;
  el('count').textContent=n+(n===1?' note':' notes')+
    (state.files.length?' · '+seen+'/'+state.files.length+' viewed':'')+
    (hid?' · '+hid+' hidden':'');
}
el('general').oninput=save;
el('reload').onclick=()=>load();
el('submit').onclick=async()=>{
  const general=el('general').value;
  if(!state.notes.size&&!general.trim()){ alert('Add at least one note before saving.'); return; }
  const r=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({general,comments:[...state.notes.values()]})});
  const d=await r.json();
  if(!r.ok){ alert('Could not save: '+(d.error||r.status)); return; }
  document.body.innerHTML='<div class="done"><p>Saved <code>'+d.file+'</code> — '+d.count+' notes.</p>'+
    '<p>Hand it to the agent:</p><p><code>Address the notes in '+d.file+'</code></p>'+
    '<p style="color:var(--ink-faint)">Server still running. Reload this page to review again.</p></div>';
};
