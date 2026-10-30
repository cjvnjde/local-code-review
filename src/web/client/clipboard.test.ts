import { afterEach, expect, test } from 'bun:test';
import { copyText } from './clipboard.ts';

const navigation=Object.getOwnPropertyDescriptor(globalThis,'navigator');
const promptDescriptor=Object.getOwnPropertyDescriptor(globalThis,'prompt');
afterEach(()=>{
  if(navigation) Object.defineProperty(globalThis,'navigator',navigation); else delete (globalThis as any).navigator;
  if(promptDescriptor) Object.defineProperty(globalThis,'prompt',promptDescriptor); else delete (globalThis as any).prompt;
});
test('copying a file path preserves its icon and copies the full repository-relative value',async()=>{
  let copied='';
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(text: string)=>{copied=text;}}}});
  const classes=new Set();
  const button={title:'Copy file path',innerHTML:'<svg></svg>',textContent:'',isConnected:false,
    classList:{add:(value: string)=>classes.add(value),remove:(value: string)=>classes.delete(value)}};
  await copyText(button,'deep/folder/a file.ts',true);
  expect(copied).toBe('deep/folder/a file.ts');
  expect(button.innerHTML).toBe('<svg></svg>');
  expect(button.title).toBe('Copied');
  expect(classes.has('copied')).toBe(true);
});
test('a denied clipboard keeps the full path available for manual copying',async()=>{
  let offered: any[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
  Object.defineProperty(globalThis,'prompt',{configurable:true,value:(...args: any[])=>{offered=args;}});
  await copyText({},'src/app.ts',true);
  expect(offered).toEqual(['Copy file path:','src/app.ts']);
});
