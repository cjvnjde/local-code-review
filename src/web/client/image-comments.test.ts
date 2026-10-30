import { afterEach, expect, test } from 'bun:test';
import { paintImageNotes, watchImageComments } from './image-comments.ts';
import { state } from './state.ts';

const original=Object.getOwnPropertyDescriptor(globalThis,'document');
const saved={files:state.files,byPath:state.byPath,notes:state.notes};
afterEach(()=>{
  Object.assign(state,saved);
  if(original) Object.defineProperty(globalThis,'document',original); else delete (globalThis as any).document;
});
function fixture(){
  const events: any={}, keys: any={}, opened: any[]=[], jumped: string[]=[];
  let busy=false;
  const node=()=>({style:{},children:[] as any[],removed:false,className:'',
    append(...children: any[]){ this.children.push(...children); },
    replaceChildren(){ this.children=[]; },remove(){ this.removed=true; }});
  const marks=node(), rects: any[]=[];
  const image={complete:true,naturalWidth:1366,naturalHeight:6814,
    getBoundingClientRect:()=>({left:100,top:50,width:683,height:3407})};
  const stage={dataset:{side:'new'},isConnected:true,querySelector:(selector: string)=>selector==='img'?image:marks,
    closest:()=>({dataset:{path:'screen.png'}}),append:(rect: any)=>rects.push(rect),setPointerCapture:()=>{}};
  const pane={addEventListener:(name: string,run: any)=>events[name]=run,querySelectorAll:()=>[stage],
    getBoundingClientRect:()=>({bottom:900})};
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:()=>pane,
    createElement:node,addEventListener:(name: string,run: any)=>keys[name]=run}});
  state.files=[{path:'screen.png',hash:'abc'}]; state.byPath=new Map([['screen.png',0]]); state.notes=new Map();
  watchImageComments({busy:()=>busy,open:(...args: any[])=>opened.push(args),jump:id=>jumped.push(id)});
  const event=(x: number,y: number,extra: any={})=>({button:0,pointerId:1,clientX:x+100,clientY:y+50,
    target:{closest:(selector: string)=>selector==='.imgstage'?stage:null},preventDefault(){},...extra});
  return {events,keys,opened,jumped,marks,rects,stage,event,busy:()=>busy=true};
}
test('dragging a scaled long screenshot opens exactly one note on the selected original pixels',()=>{
  const f=fixture();
  f.events.pointerdown(f.event(100,2100)); f.events.pointermove(f.event(300,2300));
  f.events.pointerup(f.event(300,2300)); f.events.lostpointercapture();
  expect(f.opened).toHaveLength(1);
  expect(f.opened[0][1]).toEqual({side:'new',x:200,y:4200,width:400,height:400,
    imageWidth:1366,imageHeight:6814,source:'abc'});
  expect(f.rects[0].removed).toBe(false);
});
test('Alt, cancellation, Escape and a busy editor never create a screenshot note',()=>{
  const f=fixture();
  f.events.pointerdown(f.event(10,10,{altKey:true})); f.events.pointerup(f.event(30,30));
  expect(f.rects).toHaveLength(0);
  f.events.pointerdown(f.event(10,10)); f.events.pointercancel(); f.events.pointerup(f.event(30,30));
  expect(f.rects[0].removed).toBe(true);
  f.events.pointerdown(f.event(10,10)); f.keys.keydown({key:'Escape'}); f.events.pointerup(f.event(30,30));
  expect(f.rects[1].removed).toBe(true);
  f.busy(); f.events.pointerdown(f.event(10,10)); f.events.pointerup(f.event(30,30));
  expect(f.opened).toHaveLength(0);
});
test('marks redraw from notes, follow their own side, and disappear when the image changes',()=>{
  const f=fixture();
  const image={side:'new',x:100,y:4200,width:300,height:120,
    imageWidth:1366,imageHeight:6814,source:'abc',capture:'images/area.png'};
  state.notes=new Map([['first',{id:'screen.png|*|*|#first',file:'screen.png',image}],
    ['old',{id:'screen.png|*|*|#old',file:'screen.png',image:{...image,side:'old'}}]]);
  paintImageNotes();
  expect(f.marks.children).toHaveLength(1);
  f.marks.children[0].children[0].onclick();
  expect(f.jumped).toEqual(['screen.png|*|*|#first']);
  state.files[0].hash='changed'; paintImageNotes();
  expect(f.marks.children).toHaveLength(0);
});
