import { refreshRows } from './diff-view.ts';
import { expandRange, gapOf, insertContext } from './gaps.ts';
import { busyEditor } from './notes.ts';
import { el, state } from './state.ts';

/* ---------- expanding a hidden region, one click at a time ---------- */
/** Lines one click reveals. The setting is the source of truth; this is only its floor. */
export const expandStep=()=>Math.max(1,Number(state.cfg.expand)||20);
/**
 * One expansion per file at a time. Two in flight would race: the first insertion shifts every row
 * index below it, and the second would then splice at an index measured before the shift — into the
 * middle of a hunk, deleting whatever row its stale separator index lands on.
 */
const inflight=new Set<number>();

async function fetchContext(path: string,from: number,to: number){
  const r=await fetch('/api/context?path='+encodeURIComponent(path)+'&start='+from+'&end='+to);
  const d=await r.json();
  if(!r.ok||d.error) throw new Error(d.error||('git could not read that range ('+r.status+')'));
  return d.rows||[];
}

export async function expandGap(fi: number,i: number,dir: string){
  const f=state.files[fi]; if(!f) return;
  const g=gapOf(f,i); if(!g) return;
  if(dir!=='down'&&g.to==null) return; // the far end of a trailing gap is unknown
  // The refresh below rebuilds this file's table, which would eat an editor open anywhere in it.
  if(busyEditor()) return;
  if(inflight.has(fi)) return;
  const {from,to}=expandRange(g,expandStep(),dir);
  const row=el('r'+fi+'-'+i);
  inflight.add(fi);
  if(row) row.classList.add('busy');
  try{
    const rows=await fetchContext(f.path,from,to);
    // A live reload replaced the files while git was reading: these rows belong to a dead diff.
    if(state.files[fi]!==f) return;
    const at=insertContext(f,i,dir,rows,to-from+1);
    refreshRows(fi,at<0?i:at);
  }catch(error){
    console.error(error);
    if(row&&row.isConnected) row.classList.remove('busy');
  }finally{
    inflight.delete(fi);
  }
}
