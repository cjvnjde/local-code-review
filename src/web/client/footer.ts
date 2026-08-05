import { GENERAL_MAX, autogrow } from './autogrow.ts';
import { hiddenCount } from './filters.ts';
import { load, render } from './load.ts';
import { clearNotes, save } from './persistence.ts';
import { appliedNotes, el, markSubmitted, state } from './state.ts';

/* ---------- footer ---------- */
/** Call after setting `#general` from code — only typing grows the box on its own. */
export const fitGeneral=autogrow(el('general'),GENERAL_MAX);
export function updateCount(){
  const n=state.notes.size, hid=hiddenCount(), seen=state.viewed.size, done=appliedNotes().length;
  el('count').textContent=n+(n===1?' note':' notes')+
    (state.files.length?' · '+seen+'/'+state.files.length+' viewed':'')+
    (hid?' · '+hid+' hidden':'')+
    (done?' · '+done+' applied':'');
  const btn=el('clearDone');
  btn.hidden=!done;
  btn.textContent='Remove '+done+' applied';
  btn.title=done?'Remove notes an agent reported as applied in a saved review file':'';
  /** Reset sits in settings, where nothing else counts the marks, so its label is written here. */
  const rv=el('resetViewed');
  rv.disabled=!seen;
  rv.textContent=seen?'Reset '+seen+' viewed file'+(seen===1?'':'s'):'Reset viewed files';
  rv.title=seen?'Mark every file in this diff as not viewed':'No file is marked viewed yet';
  /** Always on show, so starting over is findable; disabled is the honest state when nothing is stored. */
  const all=el('clearAll');
  const empty=!n&&!el('general').value.trim();
  all.disabled=empty;
  all.title=empty?'Nothing to clear yet'
    :'Delete every note and the overall note saved for this diff — '+
      'files that had notes go back to not viewed, the rest keep their mark';
}
/** Notes an agent already applied are finished business; dropping them keeps the next pass clean. */
el('clearDone').onclick=()=>{
  const done=appliedNotes();
  if(!done.length) return;
  if(!confirm('Remove '+done.length+' note'+(done.length===1?'':'s')+' reported as applied?')) return;
  done.forEach(n=>state.notes.delete(n.id));
  save(); render();
};
/** Starting over: everything typed for this diff goes, so ask before dropping work that cannot be undone. */
el('clearAll').onclick=()=>{
  const n=state.notes.size;
  if(!n&&!el('general').value.trim()) return;
  const files=new Set([...state.notes.values()].map((note: any)=>note.file)).size;
  if(!confirm('Delete '+(n?n+' note'+(n===1?'':'s'):'the overall note')+' and start from scratch?'+
    (files?'\n\n'+files+(files===1?' file goes':' files go')+' back to not viewed. Files without notes keep their mark.':''))) return;
  clearNotes(); fitGeneral(); render();
};
el('general').oninput=()=>{ save(); updateCount(); };
el('reload').onclick=()=>load();
el('submit').onclick=async()=>{
  const general=el('general').value;
  if(!state.notes.size&&!general.trim()){ alert('Add at least one note before saving.'); return; }
  const r=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({general,comments:[...state.notes.values()]})});
  const d=await r.json();
  if(!r.ok){ alert('Could not save: '+(d.error||r.status)); return; }
  markSubmitted(d.file); save(); // these notes are in a review file now, so verdicts can come back
  document.body.innerHTML='<div class="done"><p>Saved <code>'+d.file+'</code> — '+d.count+' notes.</p>'+
    '<p>Hand it to the agent:</p><p><code>Address the notes in '+d.file+'</code></p>'+
    '<p style="color:var(--ink-faint)">Server still running. Reload this page to review again.</p></div>';
};
