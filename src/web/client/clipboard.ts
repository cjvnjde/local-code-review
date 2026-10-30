/** Clipboard access may be refused; keep a manual copy path available. */
export async function copyText(button: any,value: string,icon=false){
  try{
    await navigator.clipboard.writeText(value);
    if(icon){
      const label=button.dataset.tooltip;
      button.dataset.tooltip='Copied'; button.classList.add('copied');
      setTimeout(()=>{ if(button.isConnected){ button.dataset.tooltip=label; button.classList.remove('copied'); } },1500);
    }else{
      const was=button.textContent;
      button.textContent='Copied';
      setTimeout(()=>{ if(button.isConnected) button.textContent=was; },1500);
    }
  }catch{ prompt(icon?'Copy file path:':'Copy this reference:',value); }
}
