import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Cdp } from './cdp.ts';
import { createWebReview } from './web-review.ts';
import { createSession } from './session.ts';
import { createHub } from './events.ts';
import { startServer } from './server.ts';
import { getDiff, getFileContext } from './diff.ts';
import { readAttachment, saveAttachment } from './attach.ts';
import { collectStatuses } from './status.ts';

// Opt-in because the ordinary suite and released executable require no installed browser.
const browserTest=process.env.LCR_TEST_BROWSER==='1'?test:test.skip;
interface Target {targetId:string;type:string;url:string}
interface DomNode {nodeId:number;shadowRoots?:DomNode[];children?:DomNode[]}
interface FrameNode {frame:{id:string;url:string};childFrames?:FrameNode[]}
browserTest('one review: diff and visual notes share editors, attachments, links, replies and references',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lcr-browser-test-'));
  async function git(...args:string[]){const child=Bun.spawn(['git',...args],{cwd:dir,stdout:'ignore',stderr:'pipe'});if(await child.exited)throw new Error(await new Response(child.stderr).text());}
  await git('init','-q');
  await writeFile(path.join(dir,'.gitignore'),'.review/\n');
  await writeFile(path.join(dir,'settings.ts'),'export const padding = 24;\n');
  await git('add','.');await git('-c','user.name=Browser test','-c','user.email=test@example.invalid','commit','-qm','initial');
  await writeFile(path.join(dir,'settings.ts'),'export const padding = 60;\n');
  const source={repoRoot:dir,context:5,diffArgs:[]};
  let version=1;
  const app=Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>new Response(`<!doctype html><html><head><title>Studio settings</title><style>
    body{margin:0;background:#f6f5fa;color:#262538;font:16px system-ui}header{padding:30px 60px;background:white;border-bottom:1px solid #ddd}main{max-width:1000px;margin:60px auto}h1{font-size:38px;margin:0 0 8px}.card{background:white;padding:32px;border:1px solid #dedce9;border-radius:16px;margin:30px 0}button{background:${version===1?'#714ed9':'#227d62'};color:white;border:0;padding:16px ${version===1?'24':'60'}px;border-radius:8px;font-size:16px}p{color:#66637b}.spacer{height:1000px}
    </style></head><body><header>STUDIO / SETTINGS</header><main><h1>Make room for your next idea.</h1><p>Manage your workspace and keep your team in sync.</p><section class="card"><h2>Workspace details</h2><p>Changes apply to everyone on your team.</p><button id="save" data-testid="save">Save changes</button></section><div class="spacer"></div><button id="bottom">Bottom action</button></main><script>
    window.clicks=0;document.querySelector('#save').onclick=()=>window.clicks++;
    document.querySelector('#save')['__reactFiber$fixture']={type:{name:'WorkspaceSettings'},_debugSource:{fileName:'src/WorkspaceSettings.tsx',lineNumber:24},return:null};
    document.querySelector('.card').__vueParentComponent={type:{__name:'SettingsCard',__file:'src/SettingsCard.vue'},parent:null};
    </script></body></html>`,{headers:{'content-type':'text/html'}})});
  const session=createSession(dir,'.review','HEAD');
  const hub=createHub();let reviewUrl='',delivered=0;
  const channel={agent:'codex' as const,available:()=>true,publish:async()=>{delivered++;return {state:'forwarded' as const,count:1};}};
  const web=createWebReview({url:'http://127.0.0.1:'+app.port,repoRoot:dir,outDir:'.review',session,hub,reviewUrl:()=>reviewUrl,browserArgs:['--headless=new','--window-size=1280,900','--force-device-scale-factor=2']});
  const server=startServer({port:0,repoRoot:dir,outDir:'.review',range:'HEAD',reviewId:'',context:5,
    getDiff:()=>getDiff(source),getContext:(file,start,end)=>getFileContext(source,file,start,end),readBlob:async()=>null,
    saveAttachment:(b,t)=>saveAttachment(dir,'.review',b,t),readAttachment:n=>readAttachment(dir,'.review',n),
    openFile:async()=>false,getStatuses:()=>collectStatuses(dir,'.review'),listReviews:async()=>[],deleteReviews:async()=>[],
    describeReviews:async()=>[],getGhosts:async()=>[],importNote:async()=>null,session,hub,channel,web});
  reviewUrl='http://127.0.0.1:'+server.port;
  let cdp:Cdp|null=null;
  try{
    await web.open();
    const active=(await readFile(path.join(dir,'.review/.browser/DevToolsActivePort'),'utf8')).trim().split('\n');
    cdp=await Cdp.connect('ws://127.0.0.1:'+active[0]+active[1]);
    const targets=async():Promise<Target[]> =>(await cdp!.send('Target.getTargets')).targetInfos;
    const reviewTarget=(await targets()).find(t=>t.url===reviewUrl+'/')!;
    let appTarget=(await targets()).find(t=>t.url===web.status().url)!;
    let sid=(await cdp.send('Target.attachToTarget',{targetId:appTarget.targetId,flatten:true})).sessionId;
    const reviewSid=(await cdp.send('Target.attachToTarget',{targetId:reviewTarget.targetId,flatten:true})).sessionId;
    const send=(method:string,params:Record<string,unknown>={})=>cdp!.send(method,params,sid);
    const errors:string[]=[];
    cdp.on('Runtime.exceptionThrown',p=>errors.push(p.exceptionDetails.exception?.description||p.exceptionDetails.text));
    cdp.on('Page.javascriptDialogOpening',event=>errors.push('Unexpected dialog: '+event.type+' '+event.message));
    await send('Runtime.enable');await cdp.send('Runtime.enable',{},reviewSid);
    await send('Page.enable');await cdp.send('Page.enable',{},reviewSid);
    async function evaluate(expression:string,session=sid,contextId?:number){
      const r=await cdp!.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,...(contextId?{contextId}:{})},session).catch(error=>{throw new Error('Browser expression '+expression+': '+String(error)+'; '+errors.join('\n'));});
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
      return r.result.value;
    }
    const js=(expression:string)=>evaluate(expression);
    const reviewJs=(expression:string)=>evaluate(expression,reviewSid);
    // These polls cross into a separate real Chrome process; fake timers cannot drive its lifecycle.
    async function until(fn:()=>Promise<unknown>,message:string){for(let i=0;i<150;i++){if(await fn())return;await Bun.sleep(100);}throw new Error('Timed out: '+message+'; browser errors: '+errors.join('\n')+'; review: '+await reviewJs('document.body.innerText'));}
    async function root(){
      await until(()=>js('!!document.querySelector("[id^=__lcr_]")'),'overlay');
      const doc:{root:DomNode}=await send('DOM.getDocument',{depth:-1,pierce:true});
      function visit(n:DomNode):DomNode|undefined{return n.shadowRoots?.[0]||n.children?.map(visit).find(Boolean);}
      const shadow=visit(doc.root)!;
      const resolved=await send('DOM.resolveNode',{nodeId:shadow.nodeId});
      await send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:'function(){globalThis.testRoot=this;}'});
    }
    const click=(selector:string)=>js(`testRoot.querySelector(${JSON.stringify(selector)}).click()`);
    async function mouse(type:string,x:number,y:number,modifiers=0){await send('Input.dispatchMouseEvent',{type,x,y,modifiers,button:'left',clickCount:1,...(type==='mousePressed'?{buttons:1}:{})});}
    let frameContext=0;
    async function frame(){
      await until(()=>js('!!testRoot.querySelector("iframe")'),'shared note frame');
      let id='';
      await until(async()=>{const tree:{frameTree:FrameNode}=await send('Page.getFrameTree');id=tree.frameTree.childFrames?.find(f=>f.frame.url.includes('?ui-'))?.frame.id||'';return id;},'loaded note frame');
      frameContext=(await send('Page.createIsolatedWorld',{frameId:id,worldName:'lcr-integration'})).executionContextId;
      await until(()=>frameJs('!!document.querySelector("#uiNote .nbox")'),'shared note editor');
    }
    const frameJs=(expression:string)=>evaluate(expression,sid,frameContext);
    async function writeComment(body:string){await frameJs(`(()=>{const ta=document.querySelector('#uiNote textarea');ta.value=${JSON.stringify(body)};ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus();})()`);}
    async function saveFrame(body:string,key?:'modified'|'plain'){
      await writeComment(body);
      if(key){const modifiers=key==='modified'?2:0;await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers});}
      else await frameJs('document.querySelector("#uiNote [data-save-note]").click()');
      await until(()=>js('testRoot.querySelector(".dock").hidden'),'editor closes after save');
    }
    await root();
    await cdp.send('Target.activateTarget',{targetId:reviewTarget.targetId});
    await until(()=>reviewJs('!!document.querySelector("tr.r")'),'Git diff alongside live page');
    expect(await reviewJs('getComputedStyle(document.querySelector("#tree")).display')).not.toBe('none');
    // Save a real diff comment first; it must be available in the visual editor's reference picker.
    await reviewJs('document.querySelector("tr.r").click();document.querySelector(".nbox textarea").value="Use the same padding in the live UI.";document.querySelector("[data-save-note]").click()');
    await until(async()=>((await session.read()).notes.length===1),'diff comment saved');
    const diffNote=(await session.read()).notes[0]!;
    const diffRef=diffNote.id.split('|#').at(-1)!;
    expect(diffNote.file).toBe('settings.ts');
    await cdp.send('Target.activateTarget',{targetId:appTarget.targetId});
    expect(await js('getComputedStyle(testRoot.querySelector(".bar")).display')).toBe('none');
    // Moving the collapsed launcher does not annotate or open it.
    const launcher=await js('(()=>{const r=testRoot.querySelector("[data-launcher]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await mouse('mousePressed',launcher.x,launcher.y);await mouse('mouseMoved',launcher.x+80,launcher.y-80);await mouse('mouseReleased',launcher.x+80,launcher.y-80);
    expect(await js('testRoot.querySelector("[data-launcher]").getAttribute("aria-expanded")')).toBe('false');
    const moved=await js('testRoot.querySelector("[data-launcher]").getBoundingClientRect().x');
    expect(moved).toBeCloseTo(launcher.x-22+80);
    expect(await js('testRoot.querySelector("[data-launcher]").getAttribute("aria-pressed")')).toBe('true');
    const box=await js('(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+10,y:r.y+10,width:r.width,height:r.height}})()');
    // A short click turns selection off without opening tools; the app receives normal clicks.
    async function pressLauncher(hold=false){
      const p=await js('(()=>{const r=testRoot.querySelector("[data-launcher]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await mouse('mousePressed',p.x,p.y);
      if(hold)await until(()=>js('!testRoot.querySelector(".bar").hidden'),'hold opens tools');
      await mouse('mouseReleased',p.x,p.y);
    }
    await pressLauncher();
    expect(await js('testRoot.querySelector("[data-launcher]").getAttribute("aria-pressed")')).toBe('false');
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
    await mouse('mousePressed',box.x,box.y);await mouse('mouseReleased',box.x,box.y);
    expect(await js('window.clicks')).toBe(1);
    expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
    // Holding opens the menu without changing selection, including on release.
    await pressLauncher(true);
    expect(await js('testRoot.querySelector("[data-launcher]").getAttribute("aria-pressed")')).toBe('false');
    await click('[data-mode="block"]');await pressLauncher();await pressLauncher();
    expect(await js('testRoot.querySelector("[data-mode=block]").getAttribute("aria-pressed")')).toBe('true');
    await click('[data-mode="element"]');
    await js('window.clicks=0');
    // Alt uses the app normally; an unmodified click annotates without expanding the launcher.
    await mouse('mousePressed',box.x,box.y,1);await mouse('mouseReleased',box.x,box.y,1);expect(await js('window.clicks')).toBe(1);
    await mouse('mouseMoved',box.x,box.y);await mouse('mousePressed',box.x,box.y);
    expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
    await mouse('mouseMoved',box.x+2,box.y+1);await mouse('mouseReleased',box.x+2,box.y+1);await frame();
    expect(await js('window.clicks')).toBe(1);
    expect(await frameJs('!!document.querySelector("#uiNote .attb")')).toBe(true);
    await frameJs('document.querySelector("#uiNote .refb").click()');
    expect(await frameJs('document.querySelector("#refpop").textContent')).toContain('Use the same padding');
    await frameJs('document.querySelector("#refpop .rfitem").click()');
    expect(await frameJs('document.querySelector("#uiNote textarea").value')).toContain('#'+diffRef);
    await saveFrame('Give the save button more breathing room. See #'+diffRef,'modified');
    const note=(await session.read()).notes.find(n=>n.web)!;
    expect(note.web!.before.mode).toBe('element');
    expect(note.web!.before.components.map(c=>c.name)).toEqual(['WorkspaceSettings','SettingsCard']);
    expect(note.web!.before.element!.attributes['data-testid']).toBe('save');
    expect(note.web!.before.element!.styles['background-color']).toBe('rgb(113, 78, 217)');
    const page=await readFile(path.join(dir,'.review',note.web!.before.page)),area=await readFile(path.join(dir,'.review',note.web!.before.area));
    const scale=page.readUInt32BE(16)/note.web!.before.viewport.width;
    expect(note.web!.before.viewport.dpr).toBe(2);expect(page.readUInt32BE(20)).toBe(note.web!.before.viewport.height*scale);
    expect(Math.abs(area.readUInt32BE(16)-box.width*scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(area.readUInt32BE(20)-box.height*scale)).toBeLessThanOrEqual(2);
    expect(delivered).toBe(2);
    await until(()=>reviewJs('!!document.querySelector(".web-capture")'),'visual note next to diff');
    expect(await reviewJs('document.querySelector(".nref").dataset.nref')).toBe(diffNote.id);
    // References work in the other direction, including the visual capture in the shared preview.
    const visualRef=note.id.split('|#').at(-1)!;
    await web.review(diffNote.id).catch(error=>{throw new Error('Review navigation: '+String(error)+'; '+errors.join('\n'));});
    await until(()=>reviewJs(`[...document.querySelectorAll('.nrow')].some(r=>r.dataset.nid===${JSON.stringify(diffNote.id)})`),'reference target mounted in diff');
    await reviewJs(`(()=>{const row=[...document.querySelectorAll('.nrow')].find(r=>r.dataset.nid===${JSON.stringify(diffNote.id)});row.querySelector('.edit').click();row.querySelector('textarea').value='Match the visual result in #${visualRef}';row.querySelector('[data-save-note]').click();})()`);
    await until(()=>reviewJs('!!document.querySelector(".refpreview .web-capture")'),'visual reference preview in diff comment');
    await cdp.send('Target.activateTarget',{targetId:appTarget.targetId});
    // The page conversation is the same component, with real reply/edit/image/ref controls.
    await until(()=>js('!!testRoot.querySelector(".pin")'),'saved pin');await click('.pin');await frame();
    await session.answer(session.file,note.id,'Updated the button padding.','applied');hub.emit({type:'review',file:session.file});
    await until(()=>frameJs('document.querySelector("#uiNote").textContent.includes("Updated the button padding.")'),'live agent reply');
    await frameJs('document.querySelector("#uiNote .rbtn").click()');
    await writeComment('Keep the rounded corners too.');await frameJs('document.querySelector("#uiNote .reply .primary").click()');
    await until(async()=>((await session.read()).notes.find(n=>n.id===note.id)!.messages.length===2),'shared follow-up');
    await frameJs('document.querySelector("#uiNote .edit").click()');await writeComment('Updated visual wording.');
    // Paste a screenshot through the same native paste handler used on the main review.
    await frameJs(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(area.toString('base64'))}),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'screenshot.png',{type:'image/png'}));document.querySelector('#uiNote textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));})()`);
    await until(()=>frameJs('document.querySelector("#uiNote textarea").value.includes("images/")'),'pasted screenshot attachment');
    await frameJs('document.querySelector("#uiNote [data-save-note]").click()');
    await until(()=>js('testRoot.querySelector(".dock").hidden'),'edited visual note closes');
    await until(()=>reviewJs('document.querySelector("#loGlobal .nbody").textContent.includes("Updated visual wording.")'),'external edit adopted in main review');
    await click('.pin');await frame();
    expect(await frameJs('!!document.querySelector("#uiNote .shot img")')).toBe(true);
    // Full conversation and reference links focus the existing tab instead of creating one.
    const pagesBefore=(await targets()).filter(t=>t.type==='page').length;
    await frameJs('document.querySelector(".ui-note-tools a").click()');
    await until(()=>reviewJs('location.hash==='+JSON.stringify('#note='+visualRef)),'existing review note link');
    expect((await targets()).filter(t=>t.type==='page')).toHaveLength(pagesBefore);
    await frameJs('document.querySelector(".ui-note-tools a").click()');
    expect((await targets()).filter(t=>t.type==='page')).toHaveLength(pagesBefore);
    await cdp.send('Target.activateTarget',{targetId:appTarget.targetId});await click('[data-close]');
    await js('document.querySelector("#save").style.padding="16px 60px";document.querySelector("#save").style.background="#227d62"');
    await web.captureAfter(note.id).catch(error=>{throw new Error('Comparison capture: '+String(error)+'; '+errors.join('\n'));});expect((await session.read()).notes.find(n=>n.id===note.id)!.web!.after[0]!.rect.width).toBeGreaterThan(note.web!.before.rect.width);
    // A new drag defaults to Area without opening the circle or preselecting Area.
    await reviewJs('localStorage.setItem("gitreview:settings",JSON.stringify({enterSaves:true}))');
    await mouse('mousePressed',200,220);await mouse('mouseMoved',430,350);await mouse('mouseReleased',430,350);await frame();
    await js('window.testDirty=false;window.addEventListener("message",event=>{if(event.data?.type==="lcr:ui"&&event.data.action==="dirty"&&event.data.dirty)window.testDirty=true;})');
    await writeComment('Keep this unfinished draft.');await js('window.confirm=()=>false');
    await until(()=>js('window.testDirty'),'cross-origin dirty notification');
    await click('[data-close]');expect(await js('testRoot.querySelector(".dock").hidden')).toBe(false);
    await saveFrame('Align this section with the heading.','plain');
    const areaNote=(await session.read()).notes.filter(n=>n.web).at(-1)!;
    expect(areaNote.web!.before.mode).toBe('area');expect(areaNote.web!.before.rect).toEqual({x:200,y:220,width:230,height:130});
    // Reload restores pins and the launcher location, not the requirement to expand tools.
    const navigated=Promise.withResolvers<void>();
    const offNavigation=cdp.on('Page.frameNavigated',(event,eventSid)=>{if(eventSid===sid&&!event.frame.parentId){offNavigation();navigated.resolve();}});
    version=2;await send('Page.reload');await navigated.promise;await root();
    await until(()=>js('testRoot.querySelectorAll(".pin").length===2'),'restored pins');
    expect(await js('testRoot.querySelector("[data-launcher]").getBoundingClientRect().x')).toBeCloseTo(moved);
    await pressLauncher(true);await click('[data-mode="point"]');
    await mouse('mousePressed',240,170);await mouse('mouseReleased',240,170);await frame();await saveFrame('Add space at this location.');
    expect((await session.read()).notes.filter(n=>n.web).at(-1)!.web!.before.rect).toEqual({x:192,y:122,width:96,height:96});
    await click('[data-mode="block"]');await mouse('mouseMoved',box.x+40,box.y);await mouse('mousePressed',box.x+40,box.y);await mouse('mouseReleased',box.x+40,box.y);await frame();await saveFrame('Group these settings.');
    expect((await session.read()).notes.filter(n=>n.web).at(-1)!.web!.before.element!.tag).toBe('section');
    await click('[data-mode="element"]');
    await js('document.querySelector("#bottom").scrollIntoView({block:"center"})');
    const bottom=await js('(()=>{const r=document.querySelector("#bottom").getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()');
    await mouse('mouseMoved',bottom.x,bottom.y);await mouse('mousePressed',bottom.x,bottom.y);await mouse('mouseReleased',bottom.x,bottom.y);await frame();await saveFrame('Review this lower action.');
    expect((await session.read()).notes.filter(n=>n.web).at(-1)!.web!.before.scroll.y).toBeGreaterThan(0);
    const removed=(await session.read()).notes.filter(n=>n.web).at(-1)!;
    await until(()=>reviewJs(`[...document.querySelectorAll('#loGlobal .nrow')].some(row=>row.dataset.nid===${JSON.stringify(removed.id)})`),'visual note adopted before external deletion');
    await fetch(reviewUrl+'/api/note?id='+encodeURIComponent(removed.id),{method:'DELETE'});
    await until(()=>reviewJs(`[...document.querySelectorAll('#loGlobal .nrow')].every(row=>row.dataset.nid!==${JSON.stringify(removed.id)})`),'deletion adopted across tabs');
    await send('Page.captureScreenshot',{format:'png'}).then(r=>Bun.write('/tmp/lcr-web-overlay-smoke.png',Buffer.from(r.data,'base64')));
    await cdp.send('Page.captureScreenshot',{format:'png'},reviewSid).then(r=>Bun.write('/tmp/lcr-web-review-smoke.png',Buffer.from(r.data,'base64')));
    await cdp.send('Target.closeTarget',{targetId:appTarget.targetId});
    await until(async()=>web.status().state==='closed','reviewed tab close notification');
    await web.open();
    appTarget=(await targets()).find(t=>t.url===web.status().url)!;
    sid=(await cdp.send('Target.attachToTarget',{targetId:appTarget.targetId,flatten:true})).sessionId;await root();
    expect((await targets()).filter(t=>t.type==='page'&&t.url.startsWith(reviewUrl))).toHaveLength(1);
    expect((await session.read()).notes.filter(n=>n.web)).toHaveLength(4);expect(errors).toEqual([]);
  }finally{cdp?.close();await web.close();server.stop(true);app.stop(true);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},90_000);
