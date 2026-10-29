import { expect, test } from 'bun:test';
import { historyNavigation, historyView, type HistoryView } from './history-navigation.ts';

const view=(note=''): HistoryView=>({note,selected:'revision-1',mode:'changes',query:'',source:'',scope:'current',limit:60});
function fixture(){
  let at=0;
  const entries: any[]=[{other:'preserved'}], shown: any[]=[];
  const nav={get state(){return entries[at];},pushState(state: any){entries.splice(++at);entries[at]=state;},
    replaceState(state: any){entries[at]=state;},back(){at=Math.max(0,at-1);}};
  const route=historyNavigation(nav,v=>shown.push(v));
  return {entries,shown,nav,route,forward(){at=Math.min(entries.length-1,at+1);route.restore();}};
}

test('Back closes note history and Forward restores the selected revision and filters',()=>{
  const f=fixture(); f.route.open(view('note-a'));
  f.route.update({...view('note-a'),query:'answer',mode:'snapshot'});
  expect(f.entries.length).toBe(2);
  expect(f.nav.state.other).toBe('preserved');
  f.nav.back(); f.route.restore(); expect(f.shown.at(-1)).toBeNull();
  f.forward(); expect(f.shown.at(-1)).toMatchObject({note:'note-a',query:'answer',mode:'snapshot'});
});

test('explicit close consumes the overlay entry and repeated close cannot leave the review',()=>{
  const f=fixture(); f.route.open(view()); f.route.close(); f.route.close(); f.route.restore();
  expect(f.nav.state).toEqual({other:'preserved'});
  expect(f.shown.at(-1)).toBeNull();
  f.forward(); expect(f.shown.at(-1)).toEqual(view());
  f.route.open(view('note-b')); expect(f.entries.length).toBe(2);
});

test('foreign or malformed navigation state does not open the history overlay',()=>{
  expect(historyView({unrelated:true})).toBeNull();
  expect(historyView({lcrHistory:{...view(),mode:'edit'}})).toBeNull();
  expect(historyView({lcrHistory:{...view(),source:'<script>'}})).toBeNull();
});
