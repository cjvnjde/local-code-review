import { afterEach, beforeEach, expect, test } from 'bun:test';
import { canResolve, isResolved, noteVisible, resolutionKey, state, visibleNotes } from './state.ts';
import { historySnapshot } from './history-model.ts';
import { orderedNotes, globalNotes, strayNotes } from './anchor.ts';

const keys=['notes','resolved','showResolved','msgs','status','statusByKey','soloKeys','files','byPath','place'] as const;
const original=Object.fromEntries(keys.map(k=>[k,state[k]]));
const note={id:'one',file:'a.ts',body:'Question',a:'n1',b:'n1',start:1,end:1};
beforeEach(()=>{
  state.notes=new Map([[note.id,{...note}]]); state.resolved=new Map(); state.showResolved=false;
  state.msgs=new Map(); state.status=new Map(); state.statusByKey=new Map(); state.soloKeys=new Set();
  state.files=[]; state.byPath=new Map(); state.place=new Map();
});
afterEach(()=>Object.assign(state,original));
test('only answered conversations offer resolution',()=>{
  expect(canResolve(note)).toBe(false);
  state.msgs.set(note.id,[{role:'agent',body:'Answer'}]);
  expect(canResolve(note)).toBe(true);
  state.msgs.set(note.id,[{role:'reviewer',body:'Still waiting'}]);
  expect(canResolve(note)).toBe(false);
  for(const status of ['answered','applied','skipped']){
    state.status.set(note.id,{status}); expect(canResolve(note)).toBe(true);
  }
});
test('resolving hides a conversation from both lists without removing its content or history',()=>{
  state.msgs.set(note.id,[{role:'agent',body:'Answer'}]);
  const before=historySnapshot('review.md',[note]);
  state.resolved.set(note.id,resolutionKey(note));
  expect(isResolved(note)).toBe(true); expect(noteVisible(note)).toBe(false);
  expect(visibleNotes()).toEqual([]); expect(orderedNotes()).toEqual([]); expect(strayNotes()).toEqual([]);
  expect(state.notes.get(note.id).body).toBe('Question');
  expect(state.msgs.get(note.id)[0].body).toBe('Answer');
  expect(historySnapshot('review.md',[note])).toEqual(before);
  state.showResolved=true;
  expect(visibleNotes()).toHaveLength(1); expect(orderedNotes()).toHaveLength(1);
});
test('global notes can be resolved and explicitly reopened',()=>{
  const global={...note,file:'',a:'@',b:'@',scope:'global'};
  state.notes.set(note.id,global); state.resolved.set(note.id,resolutionKey(global));
  expect(globalNotes()).toEqual([]);
  state.resolved.delete(note.id);
  expect(globalNotes()).toEqual([global]);
});
test('a new or rewritten reply, note edit or changed verdict reopens the note',()=>{
  const resolve=()=>state.resolved.set(note.id,resolutionKey(note));
  resolve(); state.msgs.set(note.id,[{role:'agent',body:'New answer'}]); expect(isResolved(note)).toBe(false);
  resolve(); state.msgs.set(note.id,[{role:'agent',body:'Revised answer'}]); expect(isResolved(note)).toBe(false);
  resolve(); expect(isResolved({...note,body:'Follow-up question'})).toBe(false);
  resolve(); state.status.set(note.id,{status:'needs-input',detail:'Need a decision'}); expect(isResolved(note)).toBe(false);
});
