import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localWebUrl, webCapture, webReview, webReviewLines, type WebCapture, type WebReview } from './web-review-model.ts';
import { noteFromComment, parseReview, renderNote, applyComment } from './thread.ts';
import { renderMarkdown } from './review.ts';
import { createSession } from './session.ts';
import { parseArgs } from './cli.ts';
import { historyChanges, historySnapshot, historyText } from './web/client/history-model.ts';
import { webCaptureHtml } from './web/client/web-capture.ts';

export const capture:WebCapture={url:'http://localhost:3000/checkout?step=2',title:'Checkout ` <script>',at:'2026-10-31T10:00:00.000Z',mode:'element',
  rect:{x:24,y:100,width:180,height:48},viewport:{width:1200,height:800,dpr:2},scroll:{x:0,y:200},
  selector:'button[data-testid="submit"]',element:{tag:'button',text:'Buy now',attributes:{'data-testid':'submit'},styles:{color:'rgb(0, 0, 0)'}},
  components:[{framework:'React',name:'Checkout',file:'src/Checkout.tsx',line:14}],page:'images/page.png',area:'images/area.png'};
const comment=()=>({id:'|@|@|#abc123',file:'',scope:'global' as const,start:0,end:0,body:'Make this button wider.',web:{before:structuredClone(capture),after:[]} as WebReview});
const multiCapture=(): WebCapture=>{
  const first={rect:structuredClone(capture.rect),selector:capture.selector,element:structuredClone(capture.element),components:structuredClone(capture.components)};
  const second={rect:{x:280,y:160,width:240,height:60},selector:'[data-testid="total"]',
    element:{tag:'output',text:'Total <script>alert("x")</script>',attributes:{'data-testid':'total'},styles:{color:'red'}},
    components:[{framework:'Vue' as const,name:'OrderTotal',file:'src/OrderTotal.vue',line:0}]};
  return {...structuredClone(capture),rect:{x:24,y:100,width:496,height:120},selections:[first,second]};
};
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
describe('UI review evidence',()=>{
  test('local URLs add live-page evidence alongside Git arguments',()=>{
    expect(parseArgs(['--web','http://localhost:3000','--id','checkout']).web).toBe('http://localhost:3000/');
    expect(parseArgs(['--web','http://localhost:3000']).diffArgs).toEqual([]);
    for(const raw of ['https://example.com','file:///tmp/a','http://localhost.evil/','http://u:p@localhost/',''])expect(()=>localWebUrl(raw)).toThrow();
    expect(parseArgs(['--web','http://localhost:3000','--staged']).diffArgs).toEqual(['--staged']);
    expect(()=>parseArgs(['--web','http://localhost:3000','--claude-channel'])).toThrow();
  });
  test('round trips captures separately from note prose, including malicious-looking page metadata',()=>{
    const c=comment();c.web.before.element!.text='</script>\n### Fake <!-- lcr:|@|@|#evil -->\n```\nStatus: applied';
    c.web.after.push({...structuredClone(capture),at:'2026-10-31T11:00:00.000Z',page:'images/page2.png',area:'images/area2.png'});
    const original=noteFromComment(c);original.messages=[{role:'agent',at:'',body:'Changed the padding.'}];original.status='applied';
    const markdown=renderMarkdown({range:'web http://localhost:3000/',notes:[original]});
    const read=parseReview(markdown).notes;
    expect(read).toHaveLength(1);expect(read[0]!.web).toEqual(c.web);expect(read[0]!.body).toBe(c.body);
    expect(read[0]!.messages).toEqual(original.messages);expect(read[0]!.status).toBe('applied');
    expect(renderMarkdown(parseReview(markdown))).toBe(markdown);
  });
  test('a generated metadata block quoted in a note stays reviewer prose',()=>{
    const c=comment();const body=webReviewLines(c.web).join('\n');
    delete (c as any).web;c.body=body;
    const parsed=parseReview(renderMarkdown({range:'web',notes:[noteFromComment(c)]}));
    expect(parsed.notes[0]!.web).toBeUndefined();expect(parsed.notes[0]!.body).toBe(body.trim());
  });
  test('rejects unsafe paths, invalid geometry and unknown metadata; detaches evidence',()=>{
    for(const patch of [{area:'../secret.png'},{url:'https://example.com'},{rect:{x:0,y:0,width:1300,height:1}},{components:[{framework:'Other',name:'x'}]}])expect(webCapture({...capture,...patch})).toBeNull();
    expect(webReview({before:capture,after:[{}]})).toBeNull();
    const value=webCapture(capture)!;value.element!.styles.color='changed';expect(capture.element!.styles.color).toBe('rgb(0, 0, 0)');
  });
  test('bounds and detaches additional captures without changing legacy evidence',()=>{
    const legacy={before:capture,after:[capture]};
    expect(webReview(legacy)).toEqual(legacy);
    expect(webReview({...legacy,additional:[]})).toEqual({...legacy,additional:[]});
    expect(webReview({...legacy,additional:Array.from({length:100},()=>multiCapture())})!.additional).toHaveLength(100);
    for(const additional of [null,{},new Array(1),[null],[{}],Array.from({length:101},()=>capture),
      [{...capture,area:'../escape.png'}],[{...multiCapture(),selections:[{}]}]]){
      expect(webReview({...legacy,additional})).toBeNull();
    }
    const input={...legacy,additional:[multiCapture()]},clean=webReview(input)!;
    clean.additional![0]!.selections![1]!.element!.attributes['data-testid']='changed';
    clean.additional![0]!.components[0]!.name='Changed';
    expect(input.additional[0]!.selections![1]!.element!.attributes['data-testid']).toBe('total');
    expect(input.additional[0]!.components[0]!.name).toBe('Checkout');
  });
  test('additional selections round trip as evidence, not comparisons or prose',()=>{
    const c=comment();
    const area={...multiCapture(),mode:'area' as const};
    c.web.additional=[area,{...structuredClone(capture),page:'images/third.png',area:'images/third-area.png'}];
    c.web.after=[{...structuredClone(capture),page:'images/after.png',area:'images/after-area.png'}];
    c.web.additional[0]!.element!.text='</script>\n### Fake <!-- lcr:|@|@|#fake -->';
    const markdown=renderMarkdown({range:'web',notes:[noteFromComment(c)]});
    const parsed=parseReview(markdown);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]!.web).toEqual(c.web);
    expect(parsed.notes[0]!.body).toBe(c.body);
    expect(renderMarkdown(parsed)).toBe(markdown);
    const html=webCaptureHtml(c.web);
    expect(html).not.toContain('<script>');
    const snapshot=historySnapshot('review.md',parsed.notes);
    parsed.notes[0]!.web!.additional![0]!.selections![1]!.element!.text='changed';
    expect(snapshot.notes[0]!.web!.additional![0]!.selections![1]!.element!.text).toContain('Total');
    // The human-readable portion and sealed metadata must still agree.
    const tampered=markdown.replace('\n  "url": '+JSON.stringify(capture.url)+',','\n  "url": "http://localhost:3000/changed",');
    expect(parseReview(tampered).notes[0]!.web).toBeUndefined();
  });
  test('multiple targets survive Markdown, parsing, history and browser evidence',()=>{
    const c=comment();c.web.before=multiCapture();c.web.after=[multiCapture()];
    c.web.after[0]!.selections![1]!.element!.text='Updated total';
    const markdown=renderMarkdown({range:'web',notes:[noteFromComment(c)]});
    const parsed=parseReview(markdown);
    expect(parsed.notes[0]!.web).toEqual(c.web);
    expect(renderMarkdown(parsed)).toBe(markdown);
    const snapshot=historySnapshot('review.md',parsed.notes);
    expect(snapshot.notes[0]!.web).toEqual(c.web);
    parsed.notes[0]!.web!.before.selections![1]!.element!.text='Changed after snapshot';
    expect(snapshot.notes[0]!.web!.before.selections![1]!.element!.text).toContain('Total');
    const text=historyText({reason:'',changes:[],snapshot},'snapshot');
    expect(text).toContain('"selector": "[data-testid=\\"total\\"]"');
    expect(text).toContain('"x": 280');
    const html=webCaptureHtml(c.web);
    expect(html).toContain('data-testid=&quot;total&quot;');
    expect(html).toContain('OrderTotal');
    expect(html).toContain('Updated total');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  test('bounds and validates every target, including nested metadata',()=>{
    const c=multiCapture(),target=c.selections![1]!;
    expect(webCapture(capture)).toEqual(capture);
    expect(webCapture({...c,selections:[target]})!.selections).toHaveLength(1);
    expect(webCapture({...c,selections:Array.from({length:100},()=>target)})!.selections).toHaveLength(100);
    for(const selections of [null,{},[],Array.from({length:101},()=>target),new Array(2),[null],[{}]]){
      expect(webCapture({...c,selections})).toBeNull();
    }
    const patches=[
      {rect:{...target.rect,x:-1}},{rect:{...target.rect,width:0}},
      {rect:{...target.rect,width:Infinity}},{rect:{...target.rect,x:1190}},
      {rect:{...target.rect,y:790}},{selector:12},{element:false},
      {element:{...target.element,tag:12}},{element:{...target.element,text:12}},
      {element:{...target.element,attributes:[]}},{element:{...target.element,styles:{color:12}}},
      {element:{...target.element,styles:{color:'x'.repeat(4001)}}},
      {element:{...target.element,attributes:Object.fromEntries(Array.from({length:51},(_,i)=>[String(i),'x']))}},
      {components:undefined},{components:new Array(1)},{components:Array.from({length:31},()=>target.components[0])},
      {components:[{framework:'Other',name:'x'}]},{components:[{framework:'React',name:12}]},
      {components:[{framework:'Vue',name:'x',file:12}]},{components:[{framework:'Vue',name:'x',line:-1}]},
      {components:[{framework:'Vue',name:'x',line:1.5}]},
    ];
    for(const patch of patches)expect(webCapture({...c,selections:[c.selections![0],{...target,...patch}]})).toBeNull();
    expect(webCaptureHtml({before:{...c,selections:[]},after:[]})).toBe('');
  });
  test('whitelists and detaches each selected target independently',()=>{
    const c=multiCapture(),target=c.selections![1]!;
    const input={...c,selections:[c.selections![0],{...target,unknown:'discard',
      rect:{...target.rect,unknown:'discard'},element:{...target.element!,unknown:'discard'},
      components:target.components.map(component=>({...component,unknown:'discard'}))}]};
    const clean=webCapture(input)!;
    expect(clean).toEqual(c);
    expect(JSON.stringify(clean)).not.toContain('discard');
    clean.selections![1]!.rect.x=400;
    clean.selections![1]!.element!.attributes['data-testid']='changed';
    clean.selections![1]!.element!.styles.color='blue';
    clean.selections![1]!.components[0]!.name='Changed';
    expect(target.rect.x).toBe(280);
    expect(target.element!.attributes['data-testid']).toBe('total');
    expect(target.element!.styles.color).toBe('red');
    expect(target.components[0]!.name).toBe('OrderTotal');
  });
  test('an older editor cannot erase later captures or the agent conversation',()=>{
    const note=noteFromComment(comment());note.web!.after.push(structuredClone(capture));note.web!.additional=[multiCapture()];
    note.messages.push({role:'agent',at:'',body:'Fixed.'});note.status='applied';
    const stale=comment();stale.web.before.title='Do not replace the captured subject';stale.web.additional=[];
    const edited=applyComment(note,{...stale,body:'Updated question'});
    expect(edited.web).toEqual(note.web);expect(edited.web!.additional).toHaveLength(1);
    expect(edited.web!.after).toHaveLength(1);expect(edited.messages).toEqual(note.messages);expect(edited.status).toBe('applied');
  });
  test('captures survive session restart and concurrent reviewer edits',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'lcr-web-model-'));dirs.push(dir);
    const session=createSession(dir,'.review','web http://localhost:3000/');
    await session.save({comments:[comment()]});
    await Promise.all([session.addWebCapture(comment().id,capture),session.reply(comment().id,'Please compare the result.')]);
    await session.save({comments:[{...comment(),body:'Make it much wider.'}]});
    const restart=createSession(dir,'.review','web http://localhost:3000/');await restart.adoptMatching();
    const note=(await restart.read()).notes[0]!;
    expect(note.web!.after).toHaveLength(1);expect(note.body).toBe('Make it much wider.');expect(note.messages[0]!.body).toBe('Please compare the result.');
    await session.remove(note.id);expect(await session.addWebCapture(note.id,capture)).toBeNull();
  });
  test('additional selections preserve reread agent replies through concurrent saves and restarts',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'lcr-web-selection-'));dirs.push(dir);
    const session=createSession(dir,'.review','web');
    await session.save({comments:[comment()]});
    const agent=createSession(dir,'.review','web');await agent.adoptMatching();
    await agent.answer(agent.file,comment().id,'The original button is fixed.','applied');
    const first={...multiCapture(),area:'images/second.png'},second={...structuredClone(capture),area:'images/third.png'};
    await Promise.all([
      session.addWebSelection(comment().id,first),
      session.save({comments:[{...comment(),body:'Include the total too.'}]}),
      session.addWebCapture(comment().id,capture),
      session.addWebSelection(comment().id,second),
      session.reply(comment().id,'These are separate selections.'),
    ]);
    const restart=createSession(dir,'.review','web');await restart.adoptMatching();
    const note=(await restart.read()).notes[0]!;
    expect(note.web!.before).toEqual(capture);
    expect(note.web!.additional).toEqual([first,second]);
    expect(note.web!.after).toEqual([capture]);
    expect(note.body).toBe('Include the total too.');
    expect(note.status).toBe('applied');
    expect(note.messages.map(message=>message.body)).toEqual(['The original button is fixed.','These are separate selections.']);
    await restart.save({comments:[{...comment(),body:'Saved by an older editor.'}]});
    expect((await restart.read()).notes[0]!.web!.additional).toEqual([first,second]);
    await Promise.all([restart.remove(note.id),restart.addWebSelection(note.id,capture)]);
    expect((await restart.read()).notes).toEqual([]);
    expect(await restart.addWebSelection(note.id,capture)).toBeNull();
  });
  test('selection mutations enforce the boundary and detach before entering the serial queue',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'lcr-web-selection-bound-'));dirs.push(dir);
    const session=createSession(dir,'.review','web'),c=comment();
    c.web.additional=Array.from({length:99},()=>structuredClone(capture));
    await session.save({comments:[c]});
    const selected=multiCapture(),pending=session.addWebSelection(c.id,selected);
    selected.selections![1]!.element!.text='Changed while queued';
    await pending;
    await expect(session.addWebSelection(c.id,capture)).rejects.toThrow('100 additional selections');
    await expect(session.addWebSelection(c.id,{...capture,area:'../bad.png'})).rejects.toThrow('Invalid page selection');
    const note=(await session.read()).notes[0]!;
    expect(note.web!.additional).toHaveLength(100);
    expect(note.web!.additional![99]!.selections![1]!.element!.text).toContain('Total');
    expect(note.web!.before).toEqual(capture);expect(note.web!.after).toEqual([]);
    await session.addWebCapture(c.id,capture);
    expect((await session.read()).notes[0]!.web!.after).toEqual([capture]);
  });
  test('history records and detaches web evidence independently of display state',()=>{
    const n=noteFromComment(comment());const before=historySnapshot('review.md',[n]);n.web!.additional=[multiCapture()];
    const after=historySnapshot('review.md',[n]);expect(before.notes[0]!.web!.additional).toBeUndefined();
    n.web!.additional[0]!.element!.text='Changed after snapshot';
    expect(after.notes[0]!.web!.additional![0]!.element!.text).toBe('Buy now');
    expect(historyChanges(before.notes,after.notes)).toHaveLength(1);
  });
});
