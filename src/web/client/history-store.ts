import { historyChanges, type HistoryEntry, type HistorySnapshot } from './history-model.ts';

export interface HistoryInput { scope: string; repo?: string; source: 'page'|'file'; snapshot: HistorySnapshot; reason?: string; at?: number }
interface Head { key: string; snapshot: HistorySnapshot }
const EMPTY: HistorySnapshot={file:'',notes:[]};

/** Both the head and the new revision are committed in one transaction, including across tabs. */
export function historyRevision(input: HistoryInput,previous: HistorySnapshot=EMPTY): HistoryEntry|null {
  const changes=historyChanges(previous.notes,input.snapshot.notes);
  const moved=previous.file!==input.snapshot.file;
  if(!changes.length&&!moved) return null;
  let reason=input.reason||'';
  if(!reason&&moved) reason=input.snapshot.file?'Review opened or saved':'Review file removed or closed';
  return {id:crypto.randomUUID(),scope:input.scope,repo:input.repo||'',at:input.at??Date.now(),source:input.source,
    reason,beforeFile:previous.file,snapshot:input.snapshot,changes};
}

export class HistoryStore {
  private opened: Promise<IDBDatabase>|null=null;
  constructor(private factory: ()=>IDBFactory=()=>indexedDB){}
  private open(){
    if(this.opened) return this.opened;
    this.opened=new Promise<IDBDatabase>((resolve,reject)=>{
      const request=this.factory().open('lcr-review-history',1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        db.createObjectStore('heads',{keyPath:'key'});
        const entries=db.createObjectStore('entries',{keyPath:'order',autoIncrement:true});
        entries.createIndex('scope','scope');
        entries.createIndex('repo','repo');
      };
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>{ db.close(); this.opened=null; };
        resolve(db);
      };
      request.onerror=()=>reject(request.error||new Error('History storage could not be opened.'));
      request.onblocked=()=>reject(new Error('Close older lcr tabs to open history storage.'));
    });
    // A denied/unavailable store may become usable later. Do not permanently cache the rejection.
    void this.opened.catch(()=>{ this.opened=null; });
    return this.opened;
  }
  async append(input: HistoryInput): Promise<HistoryEntry|null> {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['heads','entries'],'readwrite');
      const heads=tx.objectStore('heads'), key=JSON.stringify([input.scope,input.source]);
      const read=heads.get(key), latestKey=JSON.stringify([input.scope,'latest']), latest=heads.get(latestKey);
      let entry: HistoryEntry|null=null;
      let reads=0;
      const ready=()=>{
        if(++reads<2) return;
        const previous=(read.result as Head|undefined)?.snapshot;
        entry=historyRevision(input,previous);
        // One observed change can arrive through both the file and the page. Keep one revision,
        // while advancing each source's own baseline so drafts are never mistaken for file edits.
        if(JSON.stringify((latest.result as Head|undefined)?.snapshot)===JSON.stringify(input.snapshot)) entry=null;
        if(entry){
          const added=tx.objectStore('entries').add(entry);
          added.onsuccess=()=>{ if(entry) entry.order=Number(added.result); };
        }
        heads.put({key,snapshot:input.snapshot} satisfies Head);
        if(entry) heads.put({key:latestKey,snapshot:input.snapshot} satisfies Head);
      };
      read.onsuccess=ready; latest.onsuccess=ready;
      tx.oncomplete=()=>resolve(entry);
      tx.onabort=()=>reject(tx.error||new Error('The browser could not save review history.'));
      tx.onerror=()=>{}; // onabort reports failures after the transaction has rolled back
    });
  }
  async list(scope: string,allReviews=false): Promise<HistoryEntry[]> {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('entries','readonly');
      const request=tx.objectStore('entries').index(allReviews?'repo':'scope').getAll(scope);
      tx.oncomplete=()=>resolve((request.result as HistoryEntry[]).sort((a,b)=>(b.order||0)-(a.order||0)));
      tx.onabort=()=>reject(tx.error||new Error('History could not be read.'));
      tx.onerror=()=>{};
    });
  }
}
