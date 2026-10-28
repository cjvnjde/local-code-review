/** Durable values only: scrolling, read marks and delivery/connection state are not revisions. */
export interface HistoryNote {
  id: string; file: string; scope: string; label: string;
  side: string; start: number; end: number; ca: number|null; cb: number|null;
  snippet: string; code: string; body: string; status: string; detail: string;
  messages: {role: string; at: string; body: string}[];
}
export interface HistorySnapshot { file: string; notes: HistoryNote[] }
export interface HistoryChange { id: string; before?: HistoryNote; after?: HistoryNote; kinds: string[] }
export interface HistoryEntry {
  id: string; order?: number; scope: string; repo: string; at: number; source: 'page'|'file'; reason: string;
  beforeFile: string; snapshot: HistorySnapshot; changes: HistoryChange[];
}
const text=(value: unknown)=>typeof value==='string'?value:'';
export const historyScope=(repo: string,range: string,id: string)=>JSON.stringify([repo,id?'#'+id:range]);
export function historyScopeLabel(scope: string){
  try{ const parts=JSON.parse(scope); if(Array.isArray(parts)) return String(parts[1]||''); }catch{}
  return scope;
}

/** A detached, stable representation of either the page or the review file. */
export function historySnapshot(file: string,notes: any[]): HistorySnapshot {
  return {file:text(file),notes:notes.filter(n=>n&&typeof n.id==='string').map(n=>({
    id:n.id,file:text(n.file),scope:text(n.scope),label:text(n.label),side:n.side==='old'?'old':'new',
    start:Number(n.start)||0,end:Number(n.end)||0,ca:n.ca??null,cb:n.cb??null,
    snippet:text(n.snippet),code:text(n.code),body:text(n.body),status:text(n.status)||'pending',detail:text(n.detail),
    messages:(Array.isArray(n.messages)?n.messages:[]).map(m=>({role:text(m.role),at:text(m.at),body:text(m.body)})),
  })).sort((a,b)=>a.id.localeCompare(b.id))};
}

export function historyChanges(before: HistoryNote[],after: HistoryNote[]): HistoryChange[] {
  const old=new Map(before.map(n=>[n.id,n])), next=new Map(after.map(n=>[n.id,n]));
  return [...new Set([...old.keys(),...next.keys()])].flatMap(id=>{
    const a=old.get(id), b=next.get(id);
    if(JSON.stringify(a)===JSON.stringify(b)) return [];
    const kinds: string[]=[];
    if(!a) kinds.push('Note added');
    else if(!b) kinds.push('Note removed');
    else {
      if(a.body!==b.body) kinds.push('Question edited');
      if(a.status!==b.status||a.detail!==b.detail) kinds.push('Status changed');
      if(JSON.stringify(a.messages)!==JSON.stringify(b.messages)){
        const added=b.messages.filter(m=>!a.messages.some(p=>JSON.stringify(p)===JSON.stringify(m)));
        const removed=a.messages.filter(m=>!b.messages.some(p=>JSON.stringify(p)===JSON.stringify(m)));
        if(added.length&&!removed.length) kinds.push(added.some(m=>m.role==='agent')?'AI answered':'Reply added');
        else if(removed.length&&!added.length) kinds.push(removed.some(m=>m.role==='agent')?'Answer removed':'Reply removed');
        else kinds.push('Conversation edited');
      }
      if(!kinds.length) kinds.push('Location or captured code changed');
    }
    return [{id,before:a,after:b,kinds}];
  });
}

export function historySummary(entry: Pick<HistoryEntry,'reason'|'changes'>){
  if(entry.reason) return entry.reason;
  const kinds=[...new Set(entry.changes.flatMap(c=>c.kinds))];
  return kinds.join(' · ')||'Review changed';
}
export function historyMatches(entry: HistoryEntry,query: string,noteId=''){
  if(noteId&&!entry.changes.some(c=>c.id===noteId)) return false;
  const q=query.trim().toLocaleLowerCase();
  return !q||JSON.stringify([entry.snapshot.file,historySummary(entry),entry.changes]).toLocaleLowerCase().includes(q);
}

/** Plain text makes even a deleted note reusable without writing into the live conversation. */
export function historyText(entry: HistoryEntry,mode: 'changes'|'snapshot',noteId=''){
  const text=(n: HistoryNote)=>[n.file+(n.label?':'+n.label:''),n.body,
    'Status: '+n.status+(n.detail?' — '+n.detail:''),
    ...n.messages.map(m=>(m.role==='agent'?'AI':'You')+':\n'+m.body)].join('\n\n');
  if(mode==='snapshot') return entry.snapshot.notes.filter(n=>!noteId||n.id===noteId).map(text).join('\n\n---\n\n');
  return entry.changes.filter(c=>!noteId||c.id===noteId).map(c=>
    'Before\n\n'+(c.before?text(c.before):'Not present')+'\n\nAfter\n\n'+(c.after?text(c.after):'Not present')).join('\n\n---\n\n');
}
