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
