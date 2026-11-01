import { el, esc, state } from './state.ts';

export const noteSaveLabel=()=>state.agent?'Save & ask AI':'Save note';

/** A configured ACP queue accepts durable work even while disconnected. */
export function adoptAgent(data: any){
  const connection=data.connection||null;
  const label=connection?.agent||data.agent||'';
  const queue=data.queue??null;
  const changed=state.agent!==label||JSON.stringify(state.connection)!==JSON.stringify(connection)||JSON.stringify(state.agentQueue)!==JSON.stringify(queue);
  state.agentQueue=queue;
  state.agent=label; state.connection=connection;
  const indicator=el('agentState');
  if(indicator){
    const name=connection?.agent||'';
    indicator.textContent=name?name+' '+connection.state:'No agent connected';
    indicator.title=connection?.detail||'Notes are saved locally; no automatic agent delivery is confirmed.';
  }
  drawQueue();
  document.querySelectorAll('[data-save-note]').forEach((button: any)=>{
    if(!button.disabled) button.textContent=noteSaveLabel();
  });
  return changed;
}

/** Read-only connection checks do not create model turns. */
export function startAgentStatus(repaint: ()=>void){
  let checking=false;
  const check=async()=>{
    if(checking) return;
    checking=true;
    try{
      const response=await fetch('/api/agent');
      if(response.ok&&adoptAgent(await response.json())) repaint();
    }catch{
      if(adoptAgent({queue:state.agentQueue,connection:{...state.connection,agent:state.connection?.agent||'',state:'unavailable',detail:'The review server cannot be reached.'}})) repaint();
    }finally{ checking=false; }
  };
  void check();
  setInterval(check,5000);
}

/** Execution state is independent of the Markdown verdict. Tasks stay scoped to their review. */
export function managedNoteTask(id: string){
  const tasks=state.agentQueue?.tasks||[];
  return tasks.filter((task: any)=>task.noteId===id&&task.review===state.agentQueue.review).at(-1);
}
function drawQueue(){
  const toggle=el('queueToggle'), panel=el('agentQueue');
  if(!toggle||!panel) return;
  const queue=state.agentQueue;
  toggle.hidden=!queue;
  if(!queue){panel.hidden=true;return;}
  const pending=queue.tasks.filter((task: any)=>['queued','running','approval','uncertain'].includes(task.state));
  toggle.textContent='Queue '+pending.length+(queue.paused?' · paused':'');
  toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
  // Preserve focus on permission buttons while polling an unchanged queue.
  const signature=JSON.stringify([queue,state.connection?.detail]);
  if(panel.dataset.signature===signature) return;
  panel.dataset.signature=signature;
  const button=(label: string,action: string,id='',option='')=>'<button type="button" data-action="'+action+'" data-id="'+esc(id)+'" data-option="'+esc(option)+'">'+esc(label)+'</button>';
  panel.innerHTML='<h4>Agent work queue</h4><p>'+esc(state.connection?.detail||'')+'</p><p>'+esc(queue.activity||'')+'</p>'+
    button(queue.paused?'Resume queue':'Pause queue',queue.paused?'resume':'pause')+
    '<p class="note">Pause stops the next task. Cancel requests a stop and waits for confirmation. Completed means the turn ended; the note’s verdict is separate.</p>'+
    queue.permissions.map((permission: any)=>'<div class="queue-task"><strong>Approval required</strong><pre>'+esc(JSON.stringify(permission.toolCall,null,2))+'</pre>'+permission.options.map((option: any)=>button(option.name,'permission',permission.id,option.optionId)).join('')+'</div>').join('')+
    [...queue.tasks].reverse().map((task: any)=>'<div class="queue-task"><b>'+esc(task.state)+'</b> '+esc(task.review)+'<br><code>'+esc(task.noteId)+'</code><p>'+esc(task.detail||'')+'</p>'+
      (['queued','running','approval'].includes(task.state)?button('Cancel','cancel',task.id):'')+
      (task.state==='uncertain'?button('I inspected this work; do not replay','acknowledge',task.id):'')+
      (task.state==='error'?button('Use a new session for later tasks','new-session',task.id):'')+'</div>').join('');
  panel.querySelectorAll('[data-action]').forEach((control: any)=>control.onclick=async()=>{
    control.disabled=true;
    try{
      const response=await fetch('/api/agent/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:control.dataset.action,id:control.dataset.id||undefined,option:control.dataset.option||undefined})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Queue action failed.');
      adoptAgent(data);
    }catch(error){ const message=panel.querySelector('[data-queue-error]'); if(message) message.textContent=String(error); }
    finally{control.disabled=false;}
  });
  const error=document.createElement('p'); error.dataset.queueError=''; error.setAttribute('role','alert'); panel.appendChild(error);
}
