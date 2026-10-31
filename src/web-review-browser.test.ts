import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Cdp } from './cdp.ts';
import { createWebReview } from './web-review.ts';
import { createSession } from './session.ts';
import { createHub } from './events.ts';
import { startServer } from './server.ts';
import { readAttachment, saveAttachment } from './attach.ts';
import { collectStatuses } from './status.ts';

// Opt-in because the ordinary test suite and released executable require no installed browser.
const browserTest=process.env.LCR_TEST_BROWSER==='1'?test:test.skip;
browserTest('live UI review: select, capture, save, reply, compare, reload, and read the shared review',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lcr-browser-test-'));
  let version=1;
  const app=Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>new Response(`<!doctype html><html><head><title>Studio settings</title><style>
    body{margin:0;background:#f6f5fa;color:#262538;font:16px system-ui}header{padding:30px 60px;background:white;border-bottom:1px solid #ddd}main{max-width:1000px;margin:60px auto}h1{font-size:38px;margin:0 0 8px}.card{background:white;padding:32px;border:1px solid #dedce9;border-radius:16px;margin:30px 0}button{background:${version===1?'#714ed9':'#227d62'};color:white;border:0;padding:16px ${version===1?'24':'60'}px;border-radius:8px;font-size:16px}p{color:#66637b}.spacer{height:1000px}
    </style></head><body><header>STUDIO / SETTINGS</header><main><h1>Make room for your next idea.</h1><p>Manage your workspace and keep your team in sync.</p><section class="card"><h2>Workspace details</h2><p>Changes apply to everyone on your team.</p><button id="save" data-testid="save">Save changes</button></section><div class="spacer"></div><button id="bottom">Bottom action</button></main><script>
    window.clicks=0;document.querySelector('#save').onclick=()=>window.clicks++;
    document.querySelector('#save')['__reactFiber$fixture']={type:{name:'WorkspaceSettings'},_debugSource:{fileName:'src/WorkspaceSettings.tsx',lineNumber:24},return:null};
    document.querySelector('.card').__vueParentComponent={type:{__name:'SettingsCard',__file:'src/SettingsCard.vue'},parent:null};
    </script></body></html>`,{headers:{'content-type':'text/html'}})});
  const session=createSession(dir,'.review','web http://127.0.0.1:'+app.port+'/');
  const hub=createHub();let reviewUrl='';let delivered=0;
  const channel={agent:'codex' as const,available:()=>true,publish:async()=>{delivered++;return {state:'forwarded' as const,count:1};}};
  const web=createWebReview({url:'http://127.0.0.1:'+app.port,repoRoot:dir,outDir:'.review',session,hub,channel,reviewUrl:()=>reviewUrl,browserArgs:['--headless=new','--window-size=1280,900','--force-device-scale-factor=2']});
  const server=startServer({port:0,repoRoot:dir,outDir:'.review',range:'web '+web.status().url,reviewId:'',context:0,
    getDiff:async()=>[],getContext:async()=>[],readBlob:async()=>null,
    saveAttachment:(b,t)=>saveAttachment(dir,'.review',b,t),readAttachment:n=>readAttachment(dir,'.review',n),
    openFile:async()=>false,getStatuses:()=>collectStatuses(dir,'.review'),listReviews:async()=>[],deleteReviews:async()=>[],
    describeReviews:async()=>[],getGhosts:async()=>[],importNote:async()=>null,session,hub,channel,web});
  reviewUrl='http://127.0.0.1:'+server.port;
  let cdp:Cdp|null=null;
  try{
    await web.open();
    const active=(await readFile(path.join(dir,'.review/.browser/DevToolsActivePort'),'utf8')).trim().split('\n');
    cdp=await Cdp.connect('ws://127.0.0.1:'+active[0]+active[1]);
    const target=(await cdp.send('Target.getTargets')).targetInfos.find((t:any)=>t.url===web.status().url);
    let sid=(await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
    const send=(m:string,p:Record<string,unknown>={})=>cdp!.send(m,p,sid);
    const errors:string[]=[];
    cdp.on('Runtime.exceptionThrown',(p,s)=>{if(s===sid)errors.push(p.exceptionDetails.exception?.description||p.exceptionDetails.text);});
    await send('Runtime.enable');
    async function js(expression:string){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
    async function until(fn:()=>Promise<any>,message:string){for(let i=0;i<150;i++){if(await fn())return;await Bun.sleep(100);}throw new Error('Timed out: '+message+'; browser errors: '+errors.join('\n')+'; panel: '+await js('globalThis.testRoot?.querySelector(".content")?.textContent')); }
    async function root(){
      await until(()=>js('!!document.querySelector("[id^=__lcr_]")'),'toolbar');
      const doc=await send('DOM.getDocument',{depth:-1,pierce:true});
      const visit=(n:any):any=>n.shadowRoots?.[0]||n.children?.map(visit).find(Boolean);
      const shadow=visit(doc.root);expect(shadow).toBeTruthy();
      const resolved=await send('DOM.resolveNode',{nodeId:shadow.nodeId});
      await send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:'function(){globalThis.testRoot=this;}'});
    }
    async function click(selector:string){await js(`testRoot.querySelector(${JSON.stringify(selector)}).click()`);}
    async function mouse(type:string,x:number,y:number){await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1,...(type==='mousePressed'?{buttons:1}:{})});}
    await root();
    await click('[data-mode="element"]');
    const box=await js('(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+10,y:r.y+10,width:r.width,height:r.height}})()');
    await mouse('mouseMoved',box.x,box.y);await mouse('mousePressed',box.x,box.y);await mouse('mouseReleased',box.x,box.y);
    await until(()=>js('!!testRoot.querySelector("[data-save]")'),'captured element editor');
    expect(await js('window.clicks')).toBe(0);
    await js('testRoot.querySelector("textarea").value="Give the save button more breathing room."');await click('[data-save]');
    await until(async()=>((await session.read()).notes.length===1),'saved note');
    const note=(await session.read()).notes[0]!;
    expect(note.web!.before.components.map(c=>c.name)).toEqual(['WorkspaceSettings','SettingsCard']);
    expect(note.web!.before.element!.attributes['data-testid']).toBe('save');
    expect(note.web!.before.element!.styles['background-color']).toBe('rgb(113, 78, 217)');
    const page=await readFile(path.join(dir,'.review',note.web!.before.page));
    const area=await readFile(path.join(dir,'.review',note.web!.before.area));
    expect(page.readUInt32BE(16)).toBeGreaterThanOrEqual(note.web!.before.viewport.width);
    const scale=page.readUInt32BE(16)/note.web!.before.viewport.width;expect(page.readUInt32BE(20)).toBe(note.web!.before.viewport.height*scale);
    expect(note.web!.before.viewport.dpr).toBe(2);
    expect(Math.abs(area.readUInt32BE(16)-box.width*scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(area.readUInt32BE(20)-box.height*scale)).toBeLessThanOrEqual(2);
    expect(delivered).toBe(1);
    await until(()=>js('!!testRoot.querySelector("[data-reply]")'),'saved conversation');
    await session.answer(session.file,note.id,'Updated the button padding.','applied');
    await until(()=>js('testRoot.querySelector(".content").textContent.includes("Updated the button padding.")'),'live agent reply');
    await js('testRoot.querySelector("textarea").value="Keep the rounded corners too."');await click('[data-reply]');
    await until(async()=>((await session.read()).notes[0]!.messages.length===2),'reviewer follow-up');expect(delivered).toBe(2);
    // A layout change must be located again, rather than recropped at the old coordinates.
    await js('document.querySelector("#save").style.padding="16px 60px";document.querySelector("#save").style.background="#227d62"');
    await web.captureAfter(note.id);
    const after=(await session.read()).notes[0]!.web!.after[0]!;
    expect(after.rect.width).toBeGreaterThan(note.web!.before.rect.width);expect(after.area).not.toBe(note.web!.before.area);
    // Reload installs a fresh toolbar and restores saved pins and conversations.
    version=2;await send('Page.reload');await Bun.sleep(400);await root();
    await until(()=>js('testRoot.querySelectorAll(".pin").length===1'),'restored pin');
    await click('.pin');expect(await js('testRoot.querySelector(".content").textContent')).toContain('Keep the rounded corners too.');
    await click('[data-close]');await click('[data-mode="area"]');
    await mouse('mousePressed',200,220);await mouse('mouseMoved',430,350);await mouse('mouseReleased',430,350);
    await until(()=>js('!!testRoot.querySelector("[data-save]")'),'area editor');
    await js('testRoot.querySelector("textarea").value="Align this section with the heading."');await click('[data-save]');
    await until(async()=>((await session.read()).notes.length===2),'area note');
    const areaNote=(await session.read()).notes[1]!;expect(areaNote.web!.before.mode).toBe('area');expect(areaNote.web!.before.rect).toEqual({x:200,y:220,width:230,height:130});
    // The ordinary review page renders the same notes, images and comparison controls.
    const reviewTarget=await cdp.send('Target.createTarget',{url:reviewUrl});
    const reviewSid=(await cdp.send('Target.attachToTarget',{targetId:reviewTarget.targetId,flatten:true})).sessionId;
    async function reviewJs(expression:string){const r=await cdp!.send('Runtime.evaluate',{expression,returnByValue:true},reviewSid);return r.result.value;}
    await until(()=>reviewJs('document.querySelectorAll(".web-capture").length===2'),'shared review UI');
    expect(await reviewJs('document.body.classList.contains("web-review")')).toBe(true);
    expect(await reviewJs('document.querySelectorAll(".web-observation").length')).toBe(3);
    expect(await reviewJs('document.querySelectorAll("[data-web-after]").length')).toBe(2);
    await reviewJs('document.querySelector(".nrow .edit").click();document.querySelector(".nrow textarea").value="Make the save action easier to find.";document.querySelector("[data-save-note]").click()');
    await until(async()=>((await session.read()).notes[0]!.body==='Make the save action easier to find.'),'edit from the shared review');
    expect((await session.read()).notes[0]!.web!.after).toHaveLength(1);
    await cdp.send('Page.captureScreenshot',{format:'png'},reviewSid).then(r=>Bun.write('/tmp/lcr-web-review-smoke.png',Buffer.from(r.data,'base64')));
    await send('Page.captureScreenshot',{format:'png'}).then(r=>Bun.write('/tmp/lcr-web-overlay-smoke.png',Buffer.from(r.data,'base64')));
    // Point, block and scrolled selections use the same capture contract.
    await cdp.send('Target.activateTarget',{targetId:target.targetId});
    await click('[data-close]');await click('[data-mode="point"]');
    await mouse('mousePressed',240,170);await mouse('mouseReleased',240,170);
    await until(()=>js('!!testRoot.querySelector("[data-save]")'),'point editor');
    await js('testRoot.querySelector("textarea").value="Add some space at this location."');await click('[data-save]');
    await until(async()=>((await session.read()).notes.length===3),'point note');
    expect((await session.read()).notes[2]!.web!.before.rect).toEqual({x:192,y:122,width:96,height:96});
    await click('[data-close]');await click('[data-mode="block"]');
    const blockPoint=await js('(()=>{const r=document.querySelector("#save").getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()');
    await mouse('mouseMoved',blockPoint.x,blockPoint.y);await mouse('mousePressed',blockPoint.x,blockPoint.y);await mouse('mouseReleased',blockPoint.x,blockPoint.y);
    await until(()=>js('!!testRoot.querySelector("[data-save]")'),'block editor');
    await js('testRoot.querySelector("textarea").value="Group these settings together."');await click('[data-save]');
    await until(async()=>((await session.read()).notes.length===4),'block note');
    expect((await session.read()).notes[3]!.web!.before.element!.tag).toBe('section');
    await click('[data-close]');
    await js('document.querySelector("#bottom").scrollIntoView({block:"center"})');
    await click('[data-mode="element"]');
    const bottom=await js('(()=>{const r=document.querySelector("#bottom").getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()');
    await mouse('mouseMoved',bottom.x,bottom.y);await mouse('mousePressed',bottom.x,bottom.y);await mouse('mouseReleased',bottom.x,bottom.y);
    await until(()=>js('!!testRoot.querySelector("[data-save]")'),'scrolled element editor');
    await js('testRoot.querySelector("textarea").value="Review this lower action too."');await click('[data-save]');
    await until(async()=>((await session.read()).notes.length===5),'scrolled note');
    const lower=(await session.read()).notes[4]!.web!.before;expect(lower.scroll.y).toBeGreaterThan(0);
    const lowerImage=await readFile(path.join(dir,'.review',lower.area));
    const sample=await js('(async()=>{const img=new Image();img.src='+JSON.stringify('data:image/png;base64,'+lowerImage.toString('base64'))+';await img.decode();const c=document.createElement("canvas");c.width=img.width;c.height=img.height;const ctx=c.getContext("2d");ctx.drawImage(img,0,0);return [...ctx.getImageData(10,10,1,1).data].slice(0,3);})()');
    expect(sample).toEqual([34,125,98]);
    await until(()=>js('!!testRoot.querySelector("[data-reply]")'),'scrolled note conversation');
    await js('testRoot.querySelector("textarea").value="An unfinished follow-up"');
    await session.answer(session.file,(await session.read()).notes[4]!.id,'This answer arrived while you typed.','answered');
    await Bun.sleep(2200);
    expect(await js('testRoot.querySelector("textarea").value')).toBe('An unfinished follow-up');
    await js('testRoot.querySelector("textarea").value=""');
    await until(()=>js('testRoot.querySelector(".content").textContent.includes("This answer arrived while you typed.")'),'deferred answer');
    // Closing the reviewed tab should not prevent opening another in the owned browser.
    await cdp.send('Target.closeTarget',{targetId:target.targetId});
    await web.open();
    expect(web.status().state).toBe('ready');
    const reopened=(await cdp.send('Target.getTargets')).targetInfos.find((t:any)=>t.url===web.status().url);
    sid=(await cdp.send('Target.attachToTarget',{targetId:reopened.targetId,flatten:true})).sessionId;
    await root();await click('[data-mode="point"]');
    await mouse('mousePressed',240,170);await mouse('mouseReleased',240,170);
    await until(()=>js('!!testRoot.querySelector("[data-save]")'),'reopened editor');
    await js('testRoot.querySelector("textarea").value="One note after reopening."');
    const priorDelivery=delivered;await click('[data-save]');
    await until(async()=>((await session.read()).notes.length===6),'reopened note');
    await until(()=>js('!!testRoot.querySelector("[data-reply]")'),'reopened conversation');
    expect(delivered).toBe(priorDelivery+1);
    expect((await session.read()).notes.filter(n=>n.body==='One note after reopening.')).toHaveLength(1);
    expect(errors).toEqual([]);
  }finally{cdp?.close();await web.close();server.stop(true);app.stop(true);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},60_000);
