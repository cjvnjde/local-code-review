/* ---------- finding a note to reference ---------- */

const normalize=(value: unknown)=>String(value==null?'':value).toLocaleLowerCase();

/** A compact ordered-character match. Adjacent characters and matches near the start rank higher. */
export function fuzzyScore(query: string,value: unknown){
  const needle=normalize(query), haystack=normalize(value);
  if(!needle) return 0;
  const exact=haystack.indexOf(needle);
  if(exact>=0) return 500-exact+(exact===0||/[^\p{L}\p{N}]/u.test(haystack[exact-1])?40:0);

  let at=-1, first=-1, gaps=0, adjacent=0;
  for(const character of needle){
    const next=haystack.indexOf(character,at+1);
    if(next<0) return null;
    if(first<0) first=next;
    if(at>=0){
      if(next===at+1) adjacent++;
      else gaps+=next-at-1;
    }
    at=next;
  }
  if(gaps>Math.max(8,needle.length*3)) return null;
  return 100+adjacent*8-first-gaps*2;
}

const fileName=(note: any)=>{
  const path=String(note.file||'');
  return path.slice(path.lastIndexOf('/')+1);
};

/**
 * Every query word may match either the file name or any part of the comment. A file-name match gets
 * a field bonus larger than any fuzzy-detail score, then the original review order breaks ties.
 */
export function rankReferenceNotes<T extends {file?: unknown,body?: unknown}>(notes: T[],query: string){
  const words=normalize(query).split(/\s+/).filter(Boolean);
  if(!words.length) return notes;
  return notes.map((note,index)=>{
    let fileHits=0, score=0;
    for(const word of words){
      const inFile=fuzzyScore(word,fileName(note));
      const inBody=fuzzyScore(word,note.body);
      if(inFile==null&&inBody==null) return null;
      if(inFile!=null){ fileHits++; score+=1000+inFile; }
      else score+=inBody||0;
    }
    return {note,index,fileHits,score};
  }).filter((match): match is NonNullable<typeof match>=>match!==null)
    .sort((a,b)=>b.fileHits-a.fileHits||b.score-a.score||a.index-b.index)
    .map(match=>match.note);
}
