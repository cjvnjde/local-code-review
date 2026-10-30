import { describe, expect, test } from 'bun:test';
import { historyChanges, historyMatches, historyScope, historySnapshot } from './history-model.ts';
import { historyRevision } from './history-store.ts';

const note={id:'src/a.ts|n1|n1|#a',file:'src/a.ts',label:'1',start:1,end:1,body:'Why is this needed?'};
const snapshot=(notes: any[],file='review.md')=>historySnapshot(file,notes);
const revision=(before: any[],after: any[],source:'page'|'file'='page')=>historyRevision({scope:'r',source,
  snapshot:snapshot(after),at:42},snapshot(before))!;

describe('review history revisions',()=>{
  test('keeps screenshot coordinates and captures detached and records region changes',()=>{
    const image={side:'new',x:0,y:300,width:20,height:40,imageWidth:100,imageHeight:2000,
      source:'abc',capture:'images/area.png'};
    const saved=snapshot([{...note,image}]);
    image.y=400;
    expect(saved.notes[0]!.image?.y).toBe(300);
    const changes=historyChanges(saved.notes,snapshot([{...note,image}]).notes);
    expect(changes[0]!.kinds).toEqual(['Location or captured code changed']);
  });
  test('keeps a detached copy of questions, captured code, anchors and conversations',()=>{
    const input={...note,ca:2,cb:5,snippet:'foo',code:'const foo=1;',status:'answered',detail:'Because.',
      messages:[{role:'agent',at:'now',body:'It protects the save.'}]};
    const saved=snapshot([input]);
    input.body='Changed'; input.messages[0]!.body='Removed answer';
    expect(saved.notes[0]).toMatchObject({body:note.body,ca:2,cb:5,snippet:'foo',code:'const foo=1;',
      status:'answered',detail:'Because.',messages:[{role:'agent',at:'now',body:'It protects the save.'}]});
  });
  test('a removed question and answer survive in the before version',()=>{
    const before={...note,messages:[{role:'agent',body:'Original answer'}]};
    const entry=revision([before],[]);
    expect(entry.changes[0]!.kinds).toEqual(['Note removed']);
    expect(entry.changes[0]!.before?.messages[0]?.body).toBe('Original answer');
    expect(entry.snapshot.notes).toEqual([]);
    expect(historyMatches(entry,'original answer')).toBe(true);
  });
  test('question edits, status changes and AI answers are described separately',()=>{
    const entry=revision([note],[{...note,body:'Please explain',status:'answered',messages:[{role:'agent',body:'Here is why.'}]}]);
    expect(entry.changes[0]!.kinds).toEqual(['Question edited','Status changed','AI answered']);
    expect(entry.changes[0]!.before?.body).toBe(note.body);
    expect(entry.changes[0]!.after?.body).toBe('Please explain');
  });
  test('editing and removing either side of a conversation leaves the old text available',()=>{
    const before={...note,messages:[{role:'agent',at:'a',body:'Answer'},{role:'reviewer',at:'b',body:'Follow-up'}]};
    const removed={...before,messages:[before.messages[1]]};
    expect(revision([before],[removed],'file').changes[0]!.kinds).toEqual(['Answer removed']);
    const edited={...before,messages:[before.messages[0],{role:'reviewer',at:'b',body:'Corrected follow-up'}]};
    const entry=revision([before],[edited]);
    expect(entry.changes[0]!.kinds).toEqual(['Conversation edited']);
    expect(historyMatches(entry,'Follow-up',note.id)).toBe(true);
    expect(historyMatches(entry,'Follow-up','other-note')).toBe(false);
  });
  test('no-op reloads, note ordering, submission stamps and reading marks make no revision',()=>{
    const other={...note,id:'other',body:'Other'};
    const first=snapshot([note,other]);
    const next=snapshot([{...other,seen:7},{...note,sentAt:123,unread:4,delivery:'forwarded'}]);
    expect(next).toEqual(first);
    expect(historyRevision({scope:'r',source:'page',snapshot:next},first)).toBeNull();
  });
  test('closing or deleting a review retains the full preceding conversation',()=>{
    const before=snapshot([{...note,messages:[{role:'agent',body:'Keep this.'}]}]);
    const entry=historyRevision({scope:'r',source:'file',snapshot:snapshot([],'')},before)!;
    expect(entry.reason).toContain('removed or closed');
    expect(entry.beforeFile).toBe('review.md');
    expect(entry.changes[0]!.before?.messages[0]?.body).toBe('Keep this.');
  });
  test('a new review gets a boundary without changing any previous snapshot',()=>{
    const before=snapshot([note],'first.md');
    const entry=historyRevision({scope:'r',source:'page',snapshot:snapshot([note],'second.md')},before)!;
    expect(entry.changes).toEqual([]);
    expect(entry.beforeFile).toBe('first.md');
    expect(entry.snapshot.file).toBe('second.md');
    expect(before.file).toBe('first.md');
  });
  test('repository and named review scopes cannot collide with ranges',()=>{
    expect(historyScope('repo-a','HEAD','')).not.toBe(historyScope('repo-b','HEAD',''));
    expect(historyScope('repo-a','HEAD','review')).toBe(historyScope('repo-a','main..HEAD','review'));
    expect(historyScope('a:b','c','')).not.toBe(historyScope('a','b:c',''));
  });
  test('new notes on a previously deleted anchor are additions by their minted ids',()=>{
    const before=snapshot([note]), after=snapshot([{...note,id:'src/a.ts|n1|n1|#b'}]);
    expect(historyChanges(before.notes,after.notes).map(c=>c.kinds[0])).toEqual(['Note removed','Note added']);
  });
});
