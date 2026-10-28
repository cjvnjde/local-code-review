import { el, state } from './state.ts';

export const noteSaveLabel=()=>state.agent?'Save & ask AI':'Save note';

/** Only a confirmed/checked adapter is offered as an automatic destination. */
export function adoptAgent(data: any){
  const connection=data.connection||null;
  const agent=connection?connection.state==='ready'?connection.agent:'':data.agent;
  const label=agent==='claude'?'Claude':agent==='codex'?'Codex':'';
  const changed=state.agent!==label||JSON.stringify(state.connection)!==JSON.stringify(connection);
  state.agent=label; state.connection=connection;
  const indicator=el('agentState');
  if(indicator){
    const name=connection?.agent==='claude'?'Claude':connection?.agent==='codex'?'Codex':'';
    indicator.textContent=name?name+' '+connection.state:'No agent connected';
    indicator.title=connection?.detail||'Notes are saved locally; no automatic agent delivery is confirmed.';
  }
  document.querySelectorAll('[data-save-note]').forEach((button: any)=>{
    if(!button.disabled) button.textContent=noteSaveLabel();
  });
  return changed;
}

/** Read-only health checks do not create model turns. Claude confirms itself through its probe tool. */
export function startAgentStatus(repaint: ()=>void){
  let checking=false;
  const check=async()=>{
    if(checking) return;
    checking=true;
    try{
      const response=await fetch('/api/agent');
      if(response.ok&&adoptAgent(await response.json())) repaint();
    }catch{
      if(adoptAgent({connection:{agent:state.connection?.agent||'claude',state:'unavailable',detail:'The review server cannot be reached.'}})) repaint();
    }finally{ checking=false; }
  };
  void check();
  setInterval(check,5000);
}
