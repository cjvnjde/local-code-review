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
    async function until(fn:()=>Promise<unknown>,message:string){for(let i=0;i<150;i++){if(await fn())return;await Bun.sleep(100);}throw new Error('Timed out: '+message+'; browser errors: '+errors.join('\n')+'; review: '+await reviewJs('document.body.innerText')+'; saved notes: '+JSON.stringify((await session.read()).notes.map(n=>({id:n.id,body:n.body,extra:n.web?.additional?.length})))+'; global bodies: '+await reviewJs('JSON.stringify([...document.querySelectorAll("#loGlobal .nbody")].map(n=>n.textContent))'));}
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
    await click('[data-mode="block"]');
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
    await pressLauncher();await pressLauncher();
    expect(await js('testRoot.querySelector("[data-mode=block]").getAttribute("aria-pressed")')).toBe('true');
    // Outside clicks dismiss the one-use menu even in Browse mode.
    await pressLauncher();await pressLauncher(true);
    await mouse('mousePressed',box.x,box.y);await mouse('mouseReleased',box.x,box.y);
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
    await pressLauncher(true);
    await js('testRoot.querySelector("[data-launcher]").focus();document.querySelector("#save").focus()');
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
    await pressLauncher(true);
    // Headless target activation does not emit OS window blur, so deliver that browser event directly.
    await js('dispatchEvent(new Event("blur"))');
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
    await pressLauncher(true);await click('[data-mode="element"]');
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
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
    expect(await frameJs('document.querySelectorAll("#uiNote .nedit .cancel").length')).toBe(0);
    await writeComment('Keep this draft while moving and adding targets.');
    await frameJs('window.movingDraft=document.querySelector("#uiNote textarea");movingDraft.setSelectionRange(5,9)');
    const dockBefore=await js('(()=>{const r=testRoot.querySelector(".dock").getBoundingClientRect();return {x:r.x,y:r.y}})()');
    await mouse('mousePressed',dockBefore.x+100,dockBefore.y+20);
    await mouse('mouseMoved',dockBefore.x-20,dockBefore.y+40);await mouse('mouseReleased',dockBefore.x-20,dockBefore.y+40);
    expect(await js('testRoot.querySelector(".dock").getBoundingClientRect().x')).toBeCloseTo(dockBefore.x-120);
    expect(await js('testRoot.querySelector(".dock").getBoundingClientRect().y')).toBeCloseTo(dockBefore.y+20);
    const editorViewport=await frameJs('[innerWidth,innerHeight]');
    await click('[data-minimize]');
    expect(await js('testRoot.querySelector(".content").checkVisibility({checkVisibilityCSS:true})')).toBe(false);
    expect(await frameJs('[innerWidth,innerHeight]')).toEqual(editorViewport);
    const extraHeading=await js('(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {x:r.x+60,y:r.y+10}})()');
    await js('(()=>{const api=globalThis[testRoot.host.id],original=api.visible;api.visible=async value=>{if(!value)await new Promise(resolve=>window.releaseCapture=resolve);return original(value)};window.restoreCapture=()=>{api.visible=original;window.releaseCapture()}})()');
    await mouse('mousePressed',extraHeading.x,extraHeading.y);await mouse('mouseReleased',extraHeading.x,extraHeading.y);
    await until(()=>frameJs('document.querySelector("#uiNote [data-save-note]").disabled'),'capture blocks save');
    await frameJs('movingDraft.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true,cancelable:true}))');
    expect((await session.read()).notes.filter(n=>n.web)).toHaveLength(0);
    await js('window.restoreCapture()');
    await until(()=>frameJs('document.querySelectorAll("#uiNote .web-observation").length===2'),'selection appended to minimized draft');
    expect(await js('testRoot.querySelector(".dock").classList.contains("minimized")')).toBe(true);
    await click('[data-minimize]');
    expect(await frameJs('document.querySelector("#uiNote textarea")===window.movingDraft')).toBe(true);
    expect(await frameJs('window.movingDraft.value')).toBe('Keep this draft while moving and adding targets.');
    expect(await frameJs('[movingDraft.selectionStart,movingDraft.selectionEnd]')).toEqual([5,9]);
    await saveFrame('Give the save button more breathing room. See #'+diffRef,'modified');
    const note=(await session.read()).notes.find(n=>n.web)!;
    expect(note.web!.before.mode).toBe('element');
    expect(note.web!.before.components.map(c=>c.name)).toEqual(['WorkspaceSettings','SettingsCard']);
    expect(note.web!.before.element!.attributes['data-testid']).toBe('save');
    expect(note.web!.before.element!.styles['background-color']).toBe('rgb(113, 78, 217)');
    expect(note.web!.additional![0]!.element!.tag).toBe('h1');
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
    await frameJs('window.editedBox=document.querySelector("#uiNote textarea");editedBox.setSelectionRange(3,7)');
    const extraSubheading=await js('(()=>{const r=document.querySelector("h2").getBoundingClientRect();return {x:r.x+60,y:r.y+10}})()');
    await mouse('mousePressed',extraSubheading.x,extraSubheading.y);await mouse('mouseReleased',extraSubheading.x,extraSubheading.y);
    await until(async()=>((await session.read()).notes.find(n=>n.id===note.id)!.web!.additional?.length===2),'selection appended to saved note');
    await until(()=>frameJs('document.querySelectorAll("#uiNote .web-observation").length===3'),'saved note evidence adopted without repainting editor');
    expect(await frameJs('document.querySelector("#uiNote textarea")===window.editedBox')).toBe(true);
    expect(await frameJs('window.editedBox.value')).toBe('Updated visual wording.');
    expect(await frameJs('[editedBox.selectionStart,editedBox.selectionEnd]')).toEqual([3,7]);
    await frameJs('editedBox.setSelectionRange(editedBox.value.length,editedBox.value.length)');
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
    await js(`(()=>{
      const region=document.createElement('div');region.id='area-fixture';
      region.innerHTML='<div id="area-obscured" style="position:fixed;left:210px;top:230px;width:120px;height:100px;background:red;z-index:1"></div>'+
        '<section id="area-panel" style="position:fixed;left:210px;top:230px;width:120px;height:100px;background:white;z-index:2">'+
        '<button id="area-target" style="margin:10px;padding:4px">Area action</button><span id="area-hidden" style="visibility:hidden">Hidden</span></section>'+
        '<button id="area-outside" style="position:fixed;left:600px;top:230px">Outside</button>';
      document.body.append(region);
      document.querySelector('#area-panel')['__reactFiber$fixture']={type:{name:'AreaPanel'},_debugSource:{fileName:'src/AreaPanel.tsx',lineNumber:8},return:null};
    })()`);
    await mouse('mousePressed',200,220);await mouse('mouseMoved',430,350);await mouse('mouseReleased',430,350);await frame();
    await js('window.testDirty=false;window.addEventListener("message",event=>{if(event.data?.type==="lcr:ui"&&event.data.action==="dirty"&&event.data.dirty)window.testDirty=true;})');
    await writeComment('Keep this unfinished draft.');await js('window.confirm=()=>false');
    // A live settings change reaches an existing dirty embedded draft without replacing its editor.
    await frameJs('window.draftBox=document.querySelector("#uiNote textarea");draftBox.setSelectionRange(5,5)');
    await reviewJs('document.querySelector("#cfgEnter").checked=true;document.querySelector("#cfgEnter").dispatchEvent(new Event("change",{bubbles:true}))');
    await until(()=>frameJs('document.querySelector("#cfgEnter").checked'),'save setting reaches active embedded editor');
    expect(await frameJs('document.querySelector("#uiNote textarea")===window.draftBox')).toBe(true);
    expect(await frameJs('window.draftBox.value')).toBe('Keep this unfinished draft.');
    expect(await frameJs('window.draftBox.selectionStart')).toBe(5);
    await until(()=>js('window.testDirty'),'cross-origin dirty notification');
    const discarded=await js('new URL(testRoot.querySelector("iframe").src).searchParams.get("ui-draft")');
    const discardedWeb=(await (await fetch(reviewUrl+'/api/web/draft?id='+discarded)).json()).web;
    const discardedBytes=await readFile(path.join(dir,'.review',discardedWeb.before.area));
    await click('[data-close]');expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
    await until(async()=>(await fetch(reviewUrl+'/api/web/draft?id='+discarded)).status===404,'closed draft invalidated');
    expect(await readFile(path.join(dir,'.review',discardedWeb.before.area))).toEqual(discardedBytes);
    expect((await session.read()).notes.filter(n=>n.web)).toHaveLength(1);
    await mouse('mousePressed',200,220);await mouse('mouseMoved',430,350);await mouse('mouseReleased',430,350);await frame();
    await saveFrame('Align this section with the heading.','plain');
    const areaNote=(await session.read()).notes.filter(n=>n.web).at(-1)!;
    expect(areaNote.web!.before.mode).toBe('area');expect(areaNote.web!.before.rect).toEqual({x:200,y:220,width:230,height:130});
    expect(areaNote.web!.before.selections!.some(s=>s.selector==='button#area-target')).toBe(true);
    expect(areaNote.web!.before.components.map(c=>c.name)).toContain('AreaPanel');
    expect(areaNote.web!.before.components.find(c=>c.name==='AreaPanel')!.file).toBe('src/AreaPanel.tsx');
    expect(areaNote.web!.before.selections!.some(s=>/area-(hidden|outside|obscured)|__lcr_/.test(s.selector||''))).toBe(false);
    await until(()=>js('testRoot.querySelectorAll(".pin[title=\\"Align this section with the heading.\\"]").length===1'),'area evidence keeps one region pin');
    await js('history.pushState({},"","/other-view")');
    await until(()=>js('testRoot.querySelectorAll(".pin").length===0'),'notes never cross page URLs');
    await js('history.replaceState({},"","/")');
    await until(()=>js('[...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")'),'area circle returns on its own page');
    // Area circles move with matched contents, not with the old screenshot coordinates.
    await js('document.querySelector("#area-panel").style.left="270px";document.querySelector("#area-panel").style.top="245px"');
    await until(()=>js('(()=>{const p=[...testRoot.querySelectorAll(".pin")].find(p=>p.title==="Align this section with the heading.");return p&&Math.abs(p.getBoundingClientRect().left-260)<1})()'),'area circle follows its DOM anchors');
    await js('(()=>{const clone=document.querySelector("#area-panel").cloneNode(true);clone.dataset.duplicate="";document.body.append(clone)})()');
    await until(()=>js('![...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")'),'ambiguous area selectors suppress circle');
    await js('document.querySelector("[data-duplicate]").remove()');
    await until(()=>js('[...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")'),'unique area anchors restore circle');
    await web.captureAfter(areaNote.id);
    const areaAfter=(await session.read()).notes.find(n=>n.id===areaNote.id)!.web!.after[0]!;
    expect(areaAfter.rect).toEqual({...areaNote.web!.before.rect,x:260,y:235});
    expect(areaAfter.selections!.some(s=>s.selector==='button#area-target')).toBe(true);
    await js('document.querySelector("#area-target").outerHTML="<button id=\\"area-replacement\\">New action</button>"');
    await until(()=>js('![...testRoot.querySelectorAll(".pin")].some(p=>p.title==="Align this section with the heading.")'),'changed area content suppresses stale circle');
    await expect(web.captureAfter(areaNote.id)).rejects.toThrow('cannot be matched');
    // Reload restores pins and the launcher location, not the requirement to expand tools.
    const navigated=Promise.withResolvers<void>();
    const offNavigation=cdp.on('Page.frameNavigated',(event,eventSid)=>{if(eventSid===sid&&!event.frame.parentId){offNavigation();navigated.resolve();}});
    version=2;await send('Page.reload');await navigated.promise;await root();
    await until(()=>js('testRoot.querySelectorAll(".pin").length===3'),'only matching element pins restored; stale area stays hidden');
    expect(await js('testRoot.querySelector("[data-launcher]").getBoundingClientRect().x')).toBeCloseTo(moved);
    await pressLauncher(true);await click('[data-mode="point"]');
    await mouse('mousePressed',240,170);await mouse('mouseReleased',240,170);await frame();
    expect(await frameJs('document.querySelector("#cfgEnter").checked')).toBe(true);
    await saveFrame('Add space at this location.','plain');
    expect((await session.read()).notes.filter(n=>n.web).at(-1)!.web!.before.rect).toEqual({x:192,y:122,width:96,height:96});
    await pressLauncher(true);await click('[data-mode="block"]');await mouse('mouseMoved',box.x+40,box.y);await mouse('mousePressed',box.x+40,box.y);await mouse('mouseReleased',box.x+40,box.y);await frame();await saveFrame('Group these settings.');
    expect((await session.read()).notes.filter(n=>n.web).at(-1)!.web!.before.element!.tag).toBe('section');
    await pressLauncher(true);await click('[data-mode="element"]');
    // Pins follow the element offscreen rather than sticking to the viewport edge.
    await js('scrollBy(0,document.querySelector("#save").getBoundingClientRect().top+10)');
    await until(()=>js('(()=>{const p=[...testRoot.querySelectorAll(".pin")].find(p=>p.title.includes("Updated visual wording"));return p&&p.getBoundingClientRect().top<0})()'),'partly visible element pin scrolls past viewport edge');
    await js('scrollTo(0,0)');
    // Shift-click collects/toggles elements without opening an editor.
    const heading=await js('(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {x:r.x+100,y:r.y+30}})()');
    const currentSave=await js('(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await mouse('mousePressed',heading.x,heading.y,8);await mouse('mouseReleased',heading.x,heading.y,8);
    await mouse('mousePressed',currentSave.x,currentSave.y,8);await mouse('mouseReleased',currentSave.x,currentSave.y,8);
    expect(await js('testRoot.querySelectorAll(".selected").length')).toBe(2);
    expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
    await mouse('mousePressed',heading.x,heading.y,8);await mouse('mouseReleased',heading.x,heading.y,8);
    expect(await js('testRoot.querySelectorAll(".selected").length')).toBe(1);
    await mouse('mousePressed',heading.x,heading.y,8);await mouse('mouseReleased',heading.x,heading.y,8);
    await click('[data-write]');await frame();await saveFrame('Align the heading and save action together.');
    const multi=(await session.read()).notes.filter(n=>n.web).at(-1)!;
    expect(multi.web!.before.selections!.map(s=>s.element!.tag)).toEqual(['button','h1']);
    expect(multi.web!.before.rect.height).toBeGreaterThan(100);
    await until(()=>js('testRoot.querySelectorAll(".pin[title=\\"Align the heading and save action together.\\"]").length===2'),'one pin per selected element');
    const shownPins=await js('testRoot.querySelectorAll(".pin").length');
    await pressLauncher();
    expect(await js('testRoot.querySelectorAll(".pin").length')).toBe(0);
    await js('scrollBy(0,1)');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    expect(await js('testRoot.querySelectorAll(".pin").length')).toBe(0);
    await pressLauncher();
    expect(await js('testRoot.querySelectorAll(".pin").length')).toBe(shownPins);
    await web.captureAfter(multi.id);
    expect((await session.read()).notes.find(n=>n.id===multi.id)!.web!.after[0]!.selections!.map(s=>s.selector)).toEqual(multi.web!.before.selections!.map(s=>s.selector));
    await until(()=>reviewJs('document.querySelector("#loGlobal").textContent.includes("Align the heading and save action together.")'),'multi-element evidence in review');
    await pressLauncher(true);await click('[data-multiple]');
    expect(await js('testRoot.querySelector(".bar").hidden')).toBe(true);
    const multiBox=await js('(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await mouse('mousePressed',multiBox.x,multiBox.y);await mouse('mouseReleased',multiBox.x,multiBox.y);
    expect(await js('testRoot.querySelector(".dock").hidden')).toBe(true);
    expect(await js('testRoot.querySelectorAll(".selected").length')).toBe(1);
    await click('[data-clear]');
    await pressLauncher(true);await click('[data-mode="element"]');
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
    expect((await session.read()).notes.filter(n=>n.web)).toHaveLength(5);expect(errors).toEqual([]);
  }finally{cdp?.close();await web.close();server.stop(true);app.stop(true);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},90_000);
