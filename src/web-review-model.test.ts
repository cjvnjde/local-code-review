import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localWebUrl, webCapture, webReview, webReviewLines, type WebCapture } from './web-review-model.ts';
import { noteFromComment, parseReview, renderNote, applyComment } from './thread.ts';
import { renderMarkdown } from './review.ts';
import { createSession } from './session.ts';
import { parseArgs } from './cli.ts';
import { historyChanges, historySnapshot } from './web/client/history-model.ts';

export const capture:WebCapture={url:'http://localhost:3000/checkout?step=2',title:'Checkout ` <script>',at:'2026-10-31T10:00:00.000Z',mode:'element',
  rect:{x:24,y:100,width:180,height:48},viewport:{width:1200,height:800,dpr:2},scroll:{x:0,y:200},
  selector:'button[data-testid="submit"]',element:{tag:'button',text:'Buy now',attributes:{'data-testid':'submit'},styles:{color:'rgb(0, 0, 0)'}},
  components:[{framework:'React',name:'Checkout',file:'src/Checkout.tsx',line:14}],page:'images/page.png',area:'images/area.png'};
const comment=()=>({id:'|@|@|#abc123',file:'',scope:'global' as const,start:0,end:0,body:'Make this button wider.',web:{before:structuredClone(capture),after:[] as WebCapture[]}});
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
describe('UI review evidence',()=>{
  test('local URLs are explicit CLI mode, not Git arguments',()=>{
    expect(parseArgs(['--web','http://localhost:3000','--id','checkout']).web).toBe('http://localhost:3000/');
    expect(parseArgs(['--web','http://localhost:3000']).diffArgs).toEqual([]);
    for(const raw of ['https://example.com','file:///tmp/a','http://localhost.evil/','http://u:p@localhost/',''])expect(()=>localWebUrl(raw)).toThrow();
    expect(()=>parseArgs(['--web','http://localhost:3000','--staged'])).toThrow();
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
  test('an older editor cannot erase later captures or the agent conversation',()=>{
    const note=noteFromComment(comment());note.web!.after.push(structuredClone(capture));note.messages.push({role:'agent',at:'',body:'Fixed.'});note.status='applied';
    const edited=applyComment(note,{...comment(),body:'Updated question'});
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
  test('history records and detaches web evidence independently of display state',()=>{
    const n=noteFromComment(comment());const before=historySnapshot('review.md',[n]);n.web!.after.push(structuredClone(capture));
    const after=historySnapshot('review.md',[n]);expect(before.notes[0]!.web!.after).toHaveLength(0);
    expect(historyChanges(before.notes,after.notes)).toHaveLength(1);
  });
});
