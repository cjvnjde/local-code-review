import { expect, test } from 'bun:test';
import { readingTracker } from './reading-tracker.ts';

function fixture(){
  let saved=0,id=0;
  const tasks=new Map<number,{run: ()=>void,delay: number}>();
  const tracker=readingTracker(0,0,()=>saved++,{set:(run,delay)=>{tasks.set(++id,{run,delay});return id;},
    clear:id=>{tasks.delete(id);}});
  return {tracker,tasks,saved:()=>saved,settle(){const pending=[...tasks.values()];tasks.clear();pending.forEach(t=>t.run());}};
}

test('scrolling saves after a pause even without a wheel event or after a long scrollbar drag',()=>{
  const f=fixture(); f.tracker.input(0);
  f.tracker.scroll(100,10000,900,0); f.settle(); expect(f.saved()).toBe(1);
  f.tracker.scroll(150,20000,900,0); f.settle(); expect(f.saved()).toBe(2);
});
test('continuous movement debounces and a fast scan needs a longer pause',()=>{
  const f=fixture(); f.tracker.scroll(50,500,900,0);
  const slow=[...f.tasks.values()][0].delay;
  f.tracker.scroll(2000,510,900,0);
  expect(f.tasks.size).toBe(1); expect([...f.tasks.values()][0].delay).toBeGreaterThan(slow);
  f.settle(); expect(f.saved()).toBe(1);
});
test('navigation and layout corrections do not save, but new manual input immediately resumes tracking',()=>{
  const f=fixture(); f.tracker.scroll(1000,100,900,600); f.settle(); expect(f.saved()).toBe(0);
  f.tracker.pause(1100); f.tracker.scroll(1200,200,900,600); f.settle(); expect(f.saved()).toBe(0);
  f.tracker.input(600); f.tracker.scroll(1250,210,900,600); f.settle(); expect(f.saved()).toBe(1);
});
test('leaving the tab flushes a pending place once and reset cannot resurrect it',()=>{
  const f=fixture(); f.tracker.scroll(50,500,900,0); f.tracker.flush(); f.tracker.flush();
  expect(f.saved()).toBe(1);
  f.tracker.scroll(70,600,900,0); f.tracker.cancel(); f.tracker.flush(); expect(f.saved()).toBe(1);
  f.tracker.scroll(90,700,900,0,true); f.tracker.flush(); expect(f.saved()).toBe(1);
});
