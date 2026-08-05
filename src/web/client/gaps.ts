/* ---------- hidden regions: the unchanged lines git left out between hunks ---------- */

/** Last new-side line number in the run of rows directly above a hunk row. */
function newBefore(rows: any[],i: number){
  for(let k=i-1;k>=0;k--){
    const r=rows[k];
    if(r.t==='hunk') return null;
    if(r.n!=null) return r.n;
  }
  return null;
}
/** First new-side line number inside the hunk a hunk row opens. */
function newAfter(rows: any[],i: number){
  for(let k=i+1;k<rows.length;k++){
    const r=rows[k];
    if(r.t==='hunk') return null;
    if(r.n!=null) return r.n;
  }
  return null;
}
/**
 * New-side lines hidden at the hunk row `i`, or null when that boundary hides nothing. A zero-context
 * diff can leave a hunk with no line numbers on one side, and an unresolvable boundary reads as no gap
 * rather than as a guess. `to` is null on the trailing row: a diff never states how long the file is.
 */
export function gapOf(f: any,i: number){
  const rows=f.rows, r=rows[i];
  if(!r||r.t!=='hunk') return null;
  if(r.tail){
    const before=newBefore(rows,i);
    return before==null?null:{from:before+1,to:null};
  }
  const after=newAfter(rows,i);
  if(after==null) return null;
  // The first row of a file opens at line 1, so everything before its hunk is hidden.
  const before=i===0?0:newBefore(rows,i);
  if(before==null||before+1>after-1) return null;
  return {from:before+1,to:after-1};
}
/** How many lines a gap hides, or null while its far end is unknown. */
export const gapSize=(g: any)=>g&&g.to!=null?g.to-g.from+1:null;

/**
 * git prints at most `context` unchanged lines after the last change, so a run that reaches that
 * limit means the file almost certainly continues past the diff. A synthetic hunk row carries the
 * expander for it; when the run happened to end on the last line, the first expansion comes back
 * empty and drops the row again.
 */
export function hasTail(f: any,context: number){
  if(f.binary||!(context>0)||!f.rows.length) return false;
  let run=0;
  for(let i=f.rows.length-1;i>=0&&f.rows[i].t==='ctx';i--) run++;
  return run>=context;
}
/** Gives every file that continues past its last hunk a row to expand from. */
export function markTails(files: any[],context: number){
  files.forEach(f=>{ if(hasTail(f,context)) f.rows.push({t:'hunk',text:'',tail:true}); });
}

/** Range one click reveals: `down` walks the file from the hunk above, `up` walks up from the one below. */
export function expandRange(g: any,step: number,dir: string){
  if(dir==='all') return {from:g.from,to:g.to};
  if(dir==='down') return {from:g.from,to:g.to==null?g.from+step-1:Math.min(g.to,g.from+step-1)};
  return {from:Math.max(g.from,g.to-step+1),to:g.to};
}

/** Rebuilds a hunk header from the rows it now covers, so expanded lines are accounted for. */
export function retitle(f: any,i: number){
  const r=f.rows[i];
  if(!r||r.t!=='hunk'||r.tail) return;
  let o0=0,n0=0,ol=0,nl=0;
  for(let k=i+1;k<f.rows.length&&f.rows[k].t!=='hunk';k++){
    const row=f.rows[k];
    if(row.o!=null){ if(!ol) o0=row.o; ol++; }
    if(row.n!=null){ if(!nl) n0=row.n; nl++; }
  }
  r.text='@@ -'+o0+','+ol+' +'+n0+','+nl+' @@'+(r.head||'');
}
const prevHunk=(f: any,at: number)=>{
  for(let k=at-1;k>=0;k--) if(f.rows[k].t==='hunk') return k;
  return -1;
};

/**
 * Puts revealed lines into the file and returns the row index they start at, or -1 when nothing came
 * back. A boundary that no longer hides anything loses its hunk row, which is how two hunks merge.
 * `wanted` is the number of lines asked for: a short answer on the trailing row means end of file.
 */
export function insertContext(f: any,i: number,dir: string,rows: any[],wanted: number){
  const at=dir==='up'?i+1:i;
  if(rows.length) f.rows.splice(at,0,...rows);
  const hi=dir==='up'?i:i+rows.length;
  const hunk=f.rows[hi];
  if(hunk.tail){
    if(rows.length<wanted) f.rows.splice(hi,1);
  }else if(!gapOf(f,hi)){
    f.rows.splice(hi,1);
  }else{
    // Expanding upwards moves the hunk's own start, so git's section heading no longer names it.
    if(dir!=='down') hunk.head='';
    retitle(f,hi);
  }
  if(dir!=='up'){
    const prev=prevHunk(f,at); // the hunk above grew at its end
    if(prev>=0) retitle(f,prev);
  }
  delete f.wd; delete f.ki; // both cache row indices, which have just shifted
  return rows.length?at:-1;
}
