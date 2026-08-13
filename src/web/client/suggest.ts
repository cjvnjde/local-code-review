/* ---------- suggested changes ---------- */
/**
 * The lines a suggestion starts from: the new-side text of the rows the note covers, or the removed
 * text when the note covers nothing else. A note narrowed to part of a line still suggests whole
 * lines — a suggestion replaces lines, so half of one is nothing an agent could put back.
 */
export function suggestLines(rows: any[]): string[]{
  const lines=(rows||[]).filter(r=>r&&r.t!=='hunk');
  const kept=lines.filter(r=>r.n!=null);
  return (kept.length?kept:lines.filter(r=>r.o!=null)).map(r=>r.text);
}
/** Fence long enough to survive the backticks inside the code it carries. */
const fenceFor=(body: string)=>'`'.repeat(Math.max(3,...[...body.matchAll(/`+/g)].map(m=>m[0].length+1)));
/** The block a note carries a replacement in, in the same fenced form review sites use. */
export function suggestionBlock(lines: string[]): string{
  const body=lines.join('\n'), fence=fenceFor(body);
  return fence+'suggestion\n'+body+'\n'+fence;
}
/**
 * Splices a block into the note being written at the caret, on lines of its own and one blank line
 * clear of the prose around it, and answers where the code inside it now sits so the editor can put
 * the caret there.
 */
export function insertBlock(text: string,at: number,block: string){
  const cut=Math.max(0,Math.min(at,text.length));
  const head=text.slice(0,cut).replace(/\s+$/,''), tail=text.slice(cut).replace(/^\s+/,'');
  const lead=head?head+'\n\n':'';
  return {
    value:lead+block+(tail?'\n\n'+tail:''),
    from:lead.length+block.indexOf('\n')+1,
    to:lead.length+block.lastIndexOf('\n'),
  };
}
/**
 * The lines a suggestion is read against: the new side of the code the note captured, picked the same
 * way `suggestLines` picks what to seed the block with, so the block and the lines it replaces are
 * always the same lines. A note that captured nothing has none, and its suggestion is read on its own.
 */
export function capturedLines(code: string): string[]{
  if(!code||!code.trim()) return [];
  const lines=code.split('\n');
  const kept=lines.filter(l=>l[0]!=='-');
  return (kept.length?kept:lines).map(l=>l.slice(1));
}
export interface DiffLine{ t: 'ctx'|'del'|'add'; v: string }
/** Above this many pairs the table is not worth building for a block nobody reads line by line. */
const LCS_MAX=4096;
/**
 * A suggestion read as the change it makes: the lines it replaces beside the lines it puts there.
 * Matching lines at the top and bottom are taken off first, so a one-line edit inside a long block
 * reads as one line, and what is left in the middle is paired by longest common subsequence. A block
 * too large for that is shown whole, removed and then added, which is what a diff of it would be.
 */
export function lineDiff(base: string[],next: string[]): DiffLine[]{
  let head=0;
  while(head<base.length&&head<next.length&&base[head]===next[head]) head++;
  let tail=0;
  while(tail<base.length-head&&tail<next.length-head&&
    base[base.length-1-tail]===next[next.length-1-tail]) tail++;
  const o=base.slice(head,base.length-tail), n=next.slice(head,next.length-tail);
  const mid: DiffLine[]=o.length*n.length<=LCS_MAX
    ?pairLines(o,n)
    :[...o.map(v=>({t:'del' as const,v})),...n.map(v=>({t:'add' as const,v}))];
  return [
    ...base.slice(0,head).map(v=>({t:'ctx' as const,v})),
    ...mid,
    ...base.slice(base.length-tail).map(v=>({t:'ctx' as const,v})),
  ];
}
/** Longest common subsequence of two runs of lines, walked back out as removals and additions. */
function pairLines(o: string[],n: string[]): DiffLine[]{
  const w=n.length+1, len=new Uint16Array((o.length+1)*w);
  for(let i=o.length-1;i>=0;i--){
    for(let j=n.length-1;j>=0;j--){
      len[i*w+j]=o[i]===n[j]
        ?len[(i+1)*w+j+1]+1
        :Math.max(len[(i+1)*w+j],len[i*w+j+1]);
    }
  }
  const out: DiffLine[]=[];
  let i=0, j=0;
  while(i<o.length&&j<n.length){
    if(o[i]===n[j]){ out.push({t:'ctx',v:o[i]}); i++; j++; }
    // A tie is read as a replacement, so the line going out is shown above the line coming in.
    else if(len[(i+1)*w+j]>=len[i*w+j+1]) out.push({t:'del',v:o[i++]});
    else out.push({t:'add',v:n[j++]});
  }
  while(i<o.length) out.push({t:'del',v:o[i++]});
  while(j<n.length) out.push({t:'add',v:n[j++]});
  return out;
}
export interface BodyPart{ t: 'text'|'sug'; v: string }
const SUG=/(^|\n)(`{3,})suggestion[^\n]*\n([\s\S]*?)\n?\2[ \t]*(?=\n|$)/g;
/** Splits a note body into the prose it was typed as and the suggestion blocks standing in it, so a
 *  saved note can show a replacement as code rather than as backticks. */
export function bodyParts(body: string): BodyPart[]{
  const out: BodyPart[]=[], push=(v: string)=>{ const t=v.replace(/^\n+|\n+$/g,''); if(t) out.push({t:'text',v:t}); };
  let at=0, m: RegExpExecArray|null;
  SUG.lastIndex=0;
  while((m=SUG.exec(body))){
    push(body.slice(at,m.index+m[1].length));
    out.push({t:'sug',v:m[3]});
    at=SUG.lastIndex;
  }
  push(body.slice(at));
  return out;
}
