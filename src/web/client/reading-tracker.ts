import { scrollVelocity, settleDelay } from './reading-model.ts';

type Timers={set: (fn: ()=>void,ms: number)=>any,clear: (id: any)=>void};
/** Debounce reading pauses without expiring a scrollbar gesture or requiring a wheel event. */
export function readingTracker(top: number,at: number,remember: ()=>void,timers: Timers={
  set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id),
}){
  let pending: any=null,blockedUntil=0,allowedJump=0;
  const cancel=()=>{ if(pending!=null) timers.clear(pending); pending=null; };
  const commit=()=>{ pending=null; remember(); };
  return {
    cancel,
    pause(until: number){ cancel(); blockedUntil=until; },
    input(jumpUntil: number){ blockedUntil=0; allowedJump=jumpUntil; },
    scroll(next: number,now: number,limit: number,jumpUntil: number,skip=false){
      const speed=scrollVelocity(next-top,now-at);
      top=next; at=now;
      cancel();
      if(skip||now<blockedUntil||(now<jumpUntil&&allowedJump!==jumpUntil)) return;
      pending=timers.set(commit,settleDelay(speed,limit));
    },
    flush(){ if(pending!=null){ cancel(); remember(); } },
  };
}
