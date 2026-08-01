/* ---------- word-level diff: pair del/add runs, keep only the middle that really changed ---------- */
const WORDY=(c: string | null | undefined)=>c!=null&&/[\w$]/.test(c);
function diffRange(o,n){
  if(o===n) return null;
  const m=Math.min(o.length,n.length);
  let s=0;
  while(s<m&&o[s]===n[s]) s++;
  let t=0;
  while(t<m-s&&o[o.length-1-t]===n[n.length-1-t]) t++;
  const longest=Math.max(o.length,n.length);
  if(longest&&(s+t)/longest<0.2) return null; // barely related — colour the whole line instead
  const grow=(str,a,b)=>{
    while(a>0&&WORDY(str[a-1])&&WORDY(str[a])) a--;
    while(b<str.length&&WORDY(str[b-1])&&WORDY(str[b])) b++;
    return a<b?[a,b]:null;
  };
  return {o:grow(o,s,o.length-t),n:grow(n,s,n.length-t)};
}
function sim(o,n){
  if(o===n) return 1;
  const m=Math.min(o.length,n.length);
  let s=0;
  while(s<m&&o[s]===n[s]) s++;
  let t=0;
  while(t<m-s&&o[o.length-1-t]===n[n.length-1-t]) t++;
  const L=Math.max(o.length,n.length);
  return L?(s+t)/L:0;
}
export function wordDiff(f: any){
  if(f.wd) return f.wd;
  const w=new Map(), rows=f.rows;
  let i=0;
  while(i<rows.length){
    if(rows[i].t!=='del'){ i++; continue; }
    let d=i;
    while(d<rows.length&&rows[d].t==='del') d++;
    let a=d;
    while(a<rows.length&&rows[a].t==='add') a++;
    const dn=d-i, an=a-d, pairs=[];
    if(dn===an){ for(let k=0;k<dn;k++) pairs.push([i+k,d+k]); }
    else if(dn*an>0&&dn*an<=256){
      // Unequal runs: match each removed line to its likeliest replacement rather than by position.
      const used=new Set();
      for(let k=0;k<dn;k++){
        let best=-1,score=0;
        for(let q=0;q<an;q++){
          if(used.has(q)) continue;
          const s=sim(rows[i+k].text,rows[d+q].text);
          if(s>score){ score=s; best=q; }
        }
        if(best>=0&&score>=0.3){ used.add(best); pairs.push([i+k,d+best]); }
      }
    }else{
      for(let k=0;k<Math.min(dn,an);k++) pairs.push([i+k,d+k]);
    }
    pairs.forEach(pr=>{
      const r=diffRange(rows[pr[0]].text,rows[pr[1]].text);
      if(!r) return;
      if(r.o) w.set(pr[0],r.o);
      if(r.n) w.set(pr[1],r.n);
    });
    i=Math.max(a,d);
  }
  f.wd=w;
  return w;
}
