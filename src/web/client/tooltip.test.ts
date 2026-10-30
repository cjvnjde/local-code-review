import { afterEach, expect, test } from 'bun:test';
import { watchTooltips } from './tooltip.ts';

const globals=['document','window','innerWidth','innerHeight','getComputedStyle','MutationObserver'];
const originals=globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
afterEach(()=>{
  for(const [name,value] of originals){
    if(value) Object.defineProperty(globalThis,name,value); else delete (globalThis as any)[name];
  }
});
function fixture(){
  const events: any={}, windowEvents: any={}; let changed=()=>{};
  const tip: any={style:{},textContent:'',getBoundingClientRect:()=>({width:100,height:24})};
  const attrs=new Map([['aria-describedby','existing']]);
  const child={}, target: any={dataset:{tooltip:'Copy file path'},isConnected:true,
    closest:()=>target,contains:(node: any)=>node===target||node===child,
    getAttribute:(name: string)=>attrs.get(name)??null,
    setAttribute:(name: string,value: string)=>attrs.set(name,value),removeAttribute:(name: string)=>attrs.delete(name),
    getBoundingClientRect:()=>({left:190,top:180,bottom:200,width:26})};
  const values: any={document:{createElement:()=>tip,body:{append:()=>{}},
    addEventListener:(name: string,run: any)=>events[name]=run},
    window:{addEventListener:(name: string,run: any)=>windowEvents[name]=run},innerWidth:250,innerHeight:220,
    getComputedStyle:()=>({paddingLeft:'8'}),MutationObserver:class {
      constructor(run: any){ changed=run; } observe(){}
    }};
  for(const name of globals) Object.defineProperty(globalThis,name,{configurable:true,value:values[name]});
  watchTooltips();
  return {tip,target,child,events,windowEvents,attrs,changed:()=>changed()};
}
test('hover and keyboard focus show the tooltip immediately and keep it inside the viewport',()=>{
  const f=fixture();
  f.events.pointerover({target:f.target});
  expect(f.tip.hidden).toBe(false);
  expect(f.tip.textContent).toBe('Copy file path');
  expect(f.tip.style).toEqual({left:'142px',top:'148px'});
  expect(f.attrs.get('aria-describedby')).toBe('existing fileTooltip');
  f.events.pointerout({target:f.target,relatedTarget:f.child});
  expect(f.tip.hidden).toBe(false);
  f.events.pointerout({target:f.target,relatedTarget:null});
  expect(f.tip.hidden).toBe(true);
  expect(f.attrs.get('aria-describedby')).toBe('existing');
  f.events.focusin({target:f.target});
  expect(f.tip.hidden).toBe(false);
  f.events.keydown({key:'Escape'});
  expect(f.tip.hidden).toBe(true);
});
test('changing labels updates an open tooltip, and scrolling or removing its target dismisses it',()=>{
  const f=fixture();
  f.events.pointerover({target:f.target});
  f.target.dataset.tooltip='Copied'; f.changed();
  expect(f.tip.textContent).toBe('Copied');
  f.events.scroll(); expect(f.tip.hidden).toBe(true);
  f.events.focusin({target:f.target});
  f.target.isConnected=false; f.changed();
  expect(f.tip.hidden).toBe(true);
});
