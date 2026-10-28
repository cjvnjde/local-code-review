import { historyScope, historySnapshot, type HistoryEntry } from './history-model.ts';
import { HistoryStore, type HistoryInput } from './history-store.ts';
import { state, statusOf } from './state.ts';

const store=new HistoryStore();
const listeners=new Set<()=>void>();
let writes: Promise<unknown>=Promise.resolve();
let error='';
export const currentHistoryScope=()=>historyScope(state.repo,state.range,state.reviewId);
export const historyError=()=>error;
export function onHistoryChange(listener: ()=>void){ listeners.add(listener); return ()=>listeners.delete(listener); }
function announce(){ listeners.forEach(fn=>fn()); }

function record(input: HistoryInput){
  // Tests and non-browser imports need no storage. In the browser a failure is visible in History.
  if(!state.repo||typeof window==='undefined') return;
  const work=async()=>{
    try{ const entry=await store.append(input); const recovered=!!error; error=''; if(entry||recovered) announce(); }
    catch(e){ error=e instanceof Error?e.message:String(e); announce(); }
  };
  writes=writes.then(work,work);
}
/** Snapshot synchronously, before the caller's next mutation; IndexedDB writing can finish later. */
export function rememberPage(reason=''){
  record({scope:currentHistoryScope(),repo:state.repo,source:'page',reason,snapshot:historySnapshot(state.sessionFile,
    [...state.notes.values()].map((n: any)=>({...n,messages:state.msgs.get(n.id)||[],
      status:statusOf(n)?.status||'pending',detail:statusOf(n)?.detail||''})))});
}
/** Preserve the file exactly as observed, even when a local edit intentionally takes precedence. */
export function rememberReview(review: any){
  record({scope:currentHistoryScope(),repo:state.repo,source:'file',snapshot:historySnapshot(review.file||'',review.notes||[])});
}
export async function readHistory(allReviews=false): Promise<HistoryEntry[]> {
  const scope=allReviews?state.repo:currentHistoryScope();
  await writes;
  return store.list(scope,allReviews);
}
