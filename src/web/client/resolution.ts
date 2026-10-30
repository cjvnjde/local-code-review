import { render } from './load.ts';
import { busyEditor } from './notes.ts';
import { save } from './persistence.ts';
import { canResolve, el, isResolved, resolutionKey, state } from './state.ts';

/** Resolve is an acknowledgement in this browser, never a withdrawal from the Markdown conversation. */
export function startResolution(){
  const redraw=()=>{
    const top=el('diff').scrollTop;
    state.h.clear(); save(); render(); el('diff').scrollTop=top;
  };
  document.addEventListener('click',(event:MouseEvent)=>{
    const button=(event.target as HTMLElement).closest<HTMLElement>('[data-resolve]');
    if(!button) return;
    const note=state.notes.get(button.dataset.resolve);
    if(!note||busyEditor()) return;
    if(isResolved(note)) state.resolved.delete(note.id);
    else if(canResolve(note)) state.resolved.set(note.id,resolutionKey(note));
    else return;
    redraw();
  });
  el('showResolved').onclick=()=>{
    if(busyEditor()) return;
    state.showResolved=!state.showResolved;
    redraw();
  };
}
