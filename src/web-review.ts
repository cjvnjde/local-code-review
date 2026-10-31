import path from 'node:path';
import { attachRef, saveAttachment } from './attach.ts';
import type { Hub } from './events.ts';
import { launchReviewBrowser } from './review-browser.ts';
import type { ReviewSession } from './session.ts';
import { installPageReview } from './web/page-overlay.ts';
import { localWebUrl, webCapture, type WebReview } from './web-review-model.ts';

export interface WebReviewOptions {
  url:string;repoRoot:string;outDir:string;session:ReviewSession;hub:Hub;reviewUrl:()=>string;
  /** Used by browser integration tests; ordinary launches always have a visible window. */
  browserArgs?:string[];
}
export function createWebReview(options:WebReviewOptions){
  const url=localWebUrl(options.url),origin=new URL(url).origin;
  let browser:Awaited<ReturnType<typeof launchReviewBrowser>>|null=null,sessionId='',contextId=0;
  let reviewTargetId='',reviewOpening:Promise<{targetId:string;created:boolean;url:string}>|null=null;
  let opening:Promise<void>|null=null,state='closed',detail='Open the page to annotate your UI.';
  let queue:Promise<unknown>=Promise.resolve();
  const key='__lcr_'+crypto.randomUUID().replaceAll('-',''),binding=key+'_send';
  const drafts=new Map<string,WebReview>();
  let listeners:(()=>void)[]=[];
  const unbind=()=>{for(const off of listeners)off();listeners=[];};
  const status=()=>({url,state,detail});
  const send=(method:string,params:Record<string,unknown>={})=>{
    if(!browser)throw new Error('Open the review browser first.');
    return browser.cdp.send(method,params,sessionId);
  };
  async function evaluate(expression:string,executionContextId?:number){
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,
      ...(executionContextId?{contextId:executionContextId}:{})});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  }
  const api=(method:string,value:any)=>evaluate(`globalThis[${JSON.stringify(key)}].${method}(${JSON.stringify(value)})`);
  /** Only top-level pages in our owned browser can be the conversation tab, never editor frames. */
  async function ensureReviewTarget(destination=options.reviewUrl()){
    if(reviewOpening)return reviewOpening;
    if(!browser)throw new Error('Browser disconnected.');
    const cdp=browser.cdp;
    reviewOpening=(async()=>{
      const {targetInfos}=await cdp.send('Target.getTargets');
      const reviewOrigin=new URL(options.reviewUrl()).origin;
      const isReview=(target:any)=>{
        if(target.type!=='page')return false;
        try{
          const candidate=new URL(target.url);
          return candidate.origin===reviewOrigin&&!candidate.searchParams.has('ui-draft')&&!candidate.searchParams.has('ui-note');
        }catch{return false;}
      };
      const target=targetInfos.find((target:any)=>target.targetId===reviewTargetId&&isReview(target))
        ||targetInfos.find(isReview);
      if(target){reviewTargetId=target.targetId;return {targetId:reviewTargetId,created:false,url:target.url};}
      reviewTargetId=(await cdp.send('Target.createTarget',{url:destination,background:true})).targetId;
      return {targetId:reviewTargetId,created:true,url:destination};
    })();
    try{return await reviewOpening;}finally{reviewOpening=null;}
  }
  async function review(id?:string){
    let ref='';
    if(id!==undefined){
      if(typeof id!=='string'||!(await options.session.read()).notes.some(note=>note.id===id))
        throw new Error('That note no longer exists.');
      ref=/\|#([0-9a-z]+)$/.exec(id)?.[1]||'';
      if(!ref)throw new Error('That note has no valid reference.');
    }
    if(!browser?.cdp.connected)await open();
    if(!browser)throw new Error('Browser disconnected.');
    const destination=new URL(options.reviewUrl());
    if(ref)destination.hash='note='+encodeURIComponent(ref);
    const target=await ensureReviewTarget(destination.href);
    await browser.cdp.send('Target.activateTarget',{targetId:target.targetId});
    if(ref&&!target.created){
      const attached=await browser.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      try{
        // Native fragment navigation keeps the document and its active editors intact.
        const next=new URL(target.url);
        next.hash=destination.hash;
        if(target.url!==next.href){
          const navigation=await browser.cdp.send('Page.navigate',{url:next.href},attached.sessionId);
          if(navigation.errorText)throw new Error('Could not navigate to the note: '+navigation.errorText);
        }else{
          // User-facing hash handlers may open a dialog; do not await that interaction over CDP.
          await browser.cdp.send('Runtime.evaluate',{
            expression:"setTimeout(()=>dispatchEvent(new HashChangeEvent('hashchange')),0);void 0",
          },attached.sessionId);
        }
      }finally{await browser.cdp.send('Target.detachFromTarget',{sessionId:attached.sessionId}).catch(()=>{});}
    }
    return {};
  }
  async function screenshot(input:any){
    const clean=webCapture({...input,page:'images/page.png',area:'images/area.png'});
    if(!clean||new URL(clean.url).origin!==origin)throw new Error('Invalid page selection. Select an area in the reviewed localhost page.');
    const actual=await evaluate('({url:location.href,width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})');
    if(actual.url!==clean.url||actual.width!==clean.viewport.width||actual.height!==clean.viewport.height||actual.x!==clean.scroll.x||actual.y!==clean.scroll.y)
      throw new Error('The page moved during selection. Select the area again.');
    await api('visible',false);
    try{
      const page=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
      const area=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,
        clip:{x:clean.rect.x+clean.scroll.x,y:clean.rect.y+clean.scroll.y,width:clean.rect.width,height:clean.rect.height,scale:1}});
      const after=await evaluate('({url:location.href,width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})');
      if(JSON.stringify(actual)!==JSON.stringify(after))throw new Error('The page moved while capturing. Select the area again.');
      const [pageName,areaName]=await Promise.all([
        saveAttachment(options.repoRoot,options.outDir,Buffer.from(page.data,'base64'),'image/png'),
        saveAttachment(options.repoRoot,options.outDir,Buffer.from(area.data,'base64'),'image/png')]);
      if(!pageName||!areaName)throw new Error('Could not save screenshots.');
      return {capture:{...clean,page:attachRef(pageName),area:attachRef(areaName)}};
    }finally{await api('visible',true).catch(()=>{});}
  }
  async function action(name:string,payload:any){
    if(name==='notes')return {notes:(await options.session.read()).notes.filter(n=>n.web)};
    if(name==='capture'){
      const hasDraft=payload.draftId!==undefined,hasNote=payload.id!==undefined;
      if(hasDraft&&hasNote)throw new Error('Choose either a draft or a saved UI note.');
      if(hasDraft&&(typeof payload.draftId!=='string'||!drafts.has(payload.draftId)))
        throw new Error('That captured selection no longer exists.');
      if(hasNote&&(typeof payload.id!=='string'||!(await options.session.read()).notes.some(note=>note.id===payload.id&&note.web)))
        throw new Error('That UI note no longer exists.');
      const draft=hasDraft?drafts.get(payload.draftId)!:null;
      if(draft&&(draft.additional?.length??0)>=100)throw new Error('This note already has 100 additional selections.');
      const result=await screenshot(payload.capture);
      if(draft){
        (draft.additional??=[]).push(result.capture);
        return {...result,web:structuredClone(draft),draftId:payload.draftId};
      }
      if(hasNote){
        const note=await options.session.addWebSelection(payload.id,result.capture);
        if(!note?.web)throw new Error('That note was deleted before the selection was saved.');
        options.hub.emit({type:'review',file:options.session.file});
        return {...result,web:note.web};
      }
      if(drafts.size>=30)drafts.delete(drafts.keys().next().value!);
      const draftId=crypto.randomUUID(),web:WebReview={before:result.capture,after:[]};
      drafts.set(draftId,web);
      return {...result,web:structuredClone(web),draftId};
    }
    if(name==='discard'){
      if(typeof payload.draftId!=='string'||!drafts.delete(payload.draftId))
        throw new Error('That captured selection no longer exists.');
      return {};
    }
    if(name==='after'){
      const note=(await options.session.read()).notes.find(n=>n.id===payload.id);
      if(!note?.web)throw new Error('That UI note no longer exists.');
      await open(); // A background page can suspend the animation frame that locates its capture.
      const metadata=await api('prepare',note.web.before);
      const result=await screenshot(metadata);
      if(!await options.session.addWebCapture(note.id,result.capture))throw new Error('That note was deleted before the comparison was saved.');
      options.hub.emit({type:'review',file:options.session.file});
      return result;
    }
    if(name==='review')return review(payload.id);
    throw new Error('Unknown web review action.');
  }
  async function open(){
    if(opening)return opening;
    if(browser&&!browser.cdp.connected){await browser.close();browser=null;sessionId='';reviewTargetId='';}
    if(browser&&sessionId){
      try{
        const targetId=(await send('Target.getTargetInfo')).targetInfo.targetId;
        await ensureReviewTarget();
        await browser.cdp.send('Target.activateTarget',{targetId});
        return;
      }catch{sessionId='';}
    }
    opening=(async()=>{
      state='opening';detail='Starting the review browser…';
      try{
        if(!browser){
          browser=await launchReviewBrowser(path.resolve(options.repoRoot,options.outDir,'.browser'),options.browserArgs);
          const launched=browser;
          void launched.child.exited.then(()=>{launched.cdp.close();if(browser!==launched)return;browser=null;sessionId='';reviewTargetId='';state='closed';detail='The review browser closed. Reopen it to continue.';});
        }
        unbind();
        const cdp=browser.cdp;
        const targets=await cdp.send('Target.getTargets');
        const target=targets.targetInfos.find((t:any)=>t.type==='page'&&t.url==='about:blank');
        const targetId=target?.targetId||(await cdp.send('Target.createTarget',{url:'about:blank'})).targetId;
        sessionId=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
        const attachedSession=sessionId;
        const frame=(await send('Page.getFrameTree')).frameTree.frame.id;
        listeners.push(cdp.on('Runtime.executionContextsCleared',(_,sid)=>{if(sid===attachedSession)contextId=0;}));
        listeners.push(cdp.on('Runtime.executionContextCreated',(event,sid)=>{if(sid===attachedSession&&event.context.auxData?.isDefault&&event.context.auxData?.frameId===frame)contextId=event.context.id;}));
        listeners.push(cdp.on('Runtime.bindingCalled',(event,sid)=>{
          if(sid!==attachedSession||event.name!==binding||event.executionContextId!==contextId||event.payload.length>1_000_000)return;
          const context=event.executionContextId;
          let message:any;try{message=JSON.parse(event.payload);}catch{return;}
          if(!Number.isSafeInteger(message.seq)||typeof message.action!=='string')return;
          const work=async()=>{
            if(context!==contextId||attachedSession!==sessionId)return;
            let result:any;
            try{result={ok:true,value:await action(message.action,message.payload||{})};}
            catch(error){result={ok:false,error:error instanceof Error?error.message:String(error)};}
            await evaluate(`globalThis[${JSON.stringify(key)}]?.resolve(${message.seq},${JSON.stringify(result)})`,context).catch(()=>{});
          };
          queue=queue.then(work,work);
        }));
        await send('Page.enable');await send('Runtime.enable');
        await send('Runtime.addBinding',{name:binding});
        const source='('+installPageReview.toString()+')('+JSON.stringify({key,binding,origin,reviewUrl:options.reviewUrl()})+')';
        // Register before navigation: full reloads retain the toolbar; SPA navigation retains its DOM.
        await send('Page.addScriptToEvaluateOnNewDocument',{source});
        const navigation=await send('Page.navigate',{url});
        if(navigation.errorText)throw new Error('Could not load '+url+': '+navigation.errorText);
        let installed=false;
        for(let i=0;i<100;i++){
          installed=await evaluate('!!globalThis['+JSON.stringify(key)+']').catch(()=>false);
          if(installed)break;
          await Bun.sleep(100);
        }
        if(!installed)throw new Error('The annotation toolbar could not start. Check that the local app is running and its page finishes loading.');
        await ensureReviewTarget();
        await cdp.send('Target.activateTarget',{targetId});
        state='ready';detail='Click an element or drag an area to annotate. Hold Alt to interact with the app.';
        listeners.push(cdp.on('Target.detachedFromTarget',event=>{if(event.sessionId===attachedSession&&sessionId===attachedSession){sessionId='';contextId=0;state='closed';detail='The reviewed tab closed. Use Open page to continue.';}}));
      }catch(error){state='error';detail=error instanceof Error?error.message:String(error);if(browser){await browser.close();browser=null;}sessionId='';reviewTargetId='';throw error;}
      finally{opening=null;}
    })();
    return opening;
  }
  return {status,open,review(id?:string){
    const work=()=>review(id);const next=queue.then(work,work);queue=next.catch(()=>{});return next;
  },draft(id:string){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))return null;
    const web=drafts.get(id);
    return web?structuredClone(web):null;
  },async captureAfter(id:string){
    const work=()=>action('after',{id});const next=queue.then(work,work);queue=next.catch(()=>{});return next;
  },async focus(id:string){
    const note=(await options.session.read()).notes.find(n=>n.id===id);
    if(!note?.web)throw new Error('That UI note no longer exists.');
    await open();
    // Do not navigate automatically: restoring app state belongs to the reviewer.
    return api('focus',note.id);
  },async close(){unbind();const current=browser;browser=null;sessionId='';reviewTargetId='';if(current)await current.close();}};
}
export type WebReviewController=ReturnType<typeof createWebReview>;
