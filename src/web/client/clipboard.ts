/** Clipboard access may be refused; keep a manual copy path available. */
export async function copyText(button: any,value: string){
  try{
    await navigator.clipboard.writeText(value);
    const was=button.textContent;
    button.textContent='Copied';
    setTimeout(()=>{ if(button.isConnected) button.textContent=was; },1500);
  }catch{ prompt('Copy this reference:',value); }
}
