import { expect, test } from 'bun:test';
import { decorateAction } from './actions.ts';

function button(selector:string,text:string,title=''){
  const attrs=new Map<string,string>();
  const node:any={dataset:{},textContent:text,title,innerHTML:'',firstElementChild:null,
    matches:(selectors:string)=>selectors.split(',').includes(selector),
    getAttribute:(name:string)=>attrs.get(name),setAttribute:(name:string,value:string)=>attrs.set(name,value),
    removeAttribute:(name:string)=>{ if(name==='title') node.title=''; }};
  return {node,attrs};
}
test('well-known actions use a shared icon, descriptive accessible name and immediate tooltip',()=>{
  for(const selector of ['button.edit','button.history','button.del','button.rewrite','button.drop','#historyClose','#historyCopy']){
    const {node,attrs}=button(selector,'Action','Detailed action');
    decorateAction(node);
    expect(node.innerHTML).toContain('<svg'); expect(node.innerHTML).toContain('aria-hidden="true"');
    expect(attrs.get('aria-label')).toBe('Detailed action'); expect(node.dataset.tooltip).toBe('Detailed action');
  }
});
test('domain actions and short note reference tags retain their labels',()=>{
  for(const selector of ['button.resolve','button.copyref','#submit']){
    const {node}=button(selector,'Keep this label'); decorateAction(node); expect(node.innerHTML).toBe('');
  }
});
