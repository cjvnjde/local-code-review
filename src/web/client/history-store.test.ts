import { describe, expect, test } from 'bun:test';
import { HistoryStore, type HistoryInput } from './history-store.ts';
import { historySnapshot } from './history-model.ts';

/** Event-driven IndexedDB test surface: transactions serialize and failed writes roll back.
 * It deliberately knows nothing about notes, history heads, revisions or deduplication. */
function database(){
  let values=new Map<string,Map<any,any>>(), opened=false, failWrite=false;
  const schemas=new Map<string,any>(), queue:any[]=[];
  let scheduled=false, sequence=0;
  const schedule=()=>{
    if(scheduled) return;
    scheduled=true;
    queueMicrotask(()=>{
      scheduled=false;
      const tx=queue.shift(); if(!tx) return;
      const copy=structuredClone(values);
      try{
        while(tx.jobs.length) tx.jobs.shift()(copy);
        values=copy; tx.oncomplete?.();
      }catch(error){ tx.error=error; tx.onabort?.(); }
      if(queue.length) schedule();
    });
  };
  const db={
    createObjectStore(name:string,options:any){
      schemas.set(name,options); values.set(name,new Map());
      return {createIndex(){}};
    },
    close(){},
    transaction(){
      const tx:any={jobs:[],objectStore(name:string){
        const schema=schemas.get(name);
        const request=(work:(store:Map<any,any>)=>any)=>{
          const r:any={};
          tx.jobs.push((copy:typeof values)=>{r.result=structuredClone(work(copy.get(name)!)); r.onsuccess?.();});
          return r;
        };
        return {
          get:(key:any)=>request(s=>s.get(key)),
          put:(value:any)=>request(s=>{s.set(value[schema.keyPath],structuredClone(value)); return value[schema.keyPath];}),
          add:(value:any)=>request(s=>{
            if(failWrite){failWrite=false; throw new Error('Quota exceeded');}
            const key=value[schema.keyPath]??++sequence;
            if(s.has(key)) throw new Error('Duplicate key');
            s.set(key,{...structuredClone(value),[schema.keyPath]:key}); return key;
          }),
          index:(field:string)=>({getAll:(scope:string)=>request(s=>[...s.values()].filter(v=>v[field]===scope))}),
        };
      }};
      queue.push(tx); schedule(); return tx;
    },
  };
  const factory={open(){
    const r:any={};
    queueMicrotask(()=>{r.result=db; if(!opened){opened=true;r.onupgradeneeded?.();} r.onsuccess?.();});
    return r;
  }} as unknown as IDBFactory;
  return {factory,failNextWrite:()=>{failWrite=true;}};
}
const note={id:'a|n1|n1|#a',file:'a.ts',body:'Original question',start:1,end:1};
const input=(body=note.body,source:'page'|'file'='page',scope='repo:HEAD'):HistoryInput=>({
  scope,source,snapshot:historySnapshot('review.md',[{...note,body}]),at:100,
});

describe('append-only browser history storage',()=>{
  test('survives a new store instance, and deleting the current content keeps old answers',async()=>{
    const db=database(), store=new HistoryStore(()=>db.factory);
    const original=input();
    original.snapshot.notes[0]!.messages=[{role:'agent',at:'now',body:'Saved answer'}];
    await store.append(original);
    await store.append({...input(),snapshot:historySnapshot('',[])});
    const reopened=new HistoryStore(()=>db.factory);
    const entries=await reopened.list(original.scope);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.changes[0]!.before?.messages[0]?.body).toBe('Saved answer');
    expect(entries[1]!.snapshot.notes[0]!.body).toBe(note.body);
  });
  test('deduplicates repeated saves and the same change observed through page and file',async()=>{
    const db=database(), store=new HistoryStore(()=>db.factory);
    await store.append(input());
    expect(await store.append(input())).toBeNull();
    expect(await store.append(input(note.body,'file'))).toBeNull();
    await store.append(input('Edited externally','file'));
    expect(await store.append(input('Edited externally'))).toBeNull();
    const entries=await store.list('repo:HEAD');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.changes[0]!.before?.body).toBe(note.body);
    expect(entries[0]!.changes[0]!.kinds).toEqual(['Question edited']);
  });
  test('concurrent tabs serialize their heads and maintain commit order at the same clock time',async()=>{
    const db=database(), a=new HistoryStore(()=>db.factory), b=new HistoryStore(()=>db.factory);
    await Promise.all([a.append(input('First')),b.append(input('Second')),a.append(input('Third'))]);
    const entries=await a.list('repo:HEAD');
    expect(entries.map(e=>e.snapshot.notes[0]!.body).sort()).toEqual(['First','Second','Third']);
    expect(entries[0]!.changes[0]!.before?.body).toBe(entries[1]!.snapshot.notes[0]!.body);
    expect(entries[1]!.changes[0]!.before?.body).toBe(entries[2]!.snapshot.notes[0]!.body);
    expect(entries[2]!.changes[0]!.before).toBeUndefined();
  });
  test('a quota failure keeps old history and does not advance the revision baseline',async()=>{
    const db=database(), store=new HistoryStore(()=>db.factory);
    await store.append(input('First'));
    db.failNextWrite();
    await expect(store.append(input('Failed'))).rejects.toThrow('Quota exceeded');
    await store.append(input('Recovered'));
    const entries=await store.list('repo:HEAD');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.changes[0]!.before?.body).toBe('First');
  });
  test('a local draft is not treated as a deletion from the file',async()=>{
    const db=database(), store=new HistoryStore(()=>db.factory);
    await store.append(input(note.body,'file'));
    const page=input(); page.snapshot.notes.push({...page.snapshot.notes[0]!,id:'draft',body:'Unsubmitted'});
    await store.append(page);
    expect(await store.append(input(note.body,'file'))).toBeNull();
    await store.append(input('File edit','file'));
    const entries=await store.list('repo:HEAD');
    expect(entries[0]!.changes.map(c=>c.kinds)).toEqual([['Question edited']]);
  });
  test('history is isolated by repository/review scope',async()=>{
    const db=database(), store=new HistoryStore(()=>db.factory);
    await store.append(input('A','page','repo-a'));
    await store.append(input('B','page','repo-b'));
    expect((await store.list('repo-a')).map(e=>e.snapshot.notes[0]!.body)).toEqual(['A']);
    expect(await store.list('repo-c')).toEqual([]);
  });
  test('can read older review scopes for one repository without including another project',async()=>{
    const db=database(), store=new HistoryStore(()=>db.factory);
    await store.append({...input('A','page','first-range'),repo:'project'});
    await store.append({...input('B','page','second-range'),repo:'project'});
    await store.append({...input('C','page','other'),repo:'another-project'});
    expect((await store.list('project',true)).map(e=>e.snapshot.notes[0]!.body)).toEqual(['B','A']);
  });
  test('denied database access rejects without consuming the next successful attempt',async()=>{
    const db=database(); let denied=true;
    const store=new HistoryStore(()=>{if(denied) throw new Error('Access denied'); return db.factory;});
    await expect(store.append(input())).rejects.toThrow('Access denied');
    denied=false;
    expect(await store.append(input())).not.toBeNull();
  });
});
