import path from 'node:path';
import { attachRef, saveAttachment } from './attach.ts';
import type { AgentChannel } from './agent-channel.ts';
import type { Hub } from './events.ts';
import { launchReviewBrowser } from './review-browser.ts';
import type { ReviewSession } from './session.ts';
import { installPageReview } from './web/page-overlay.ts';
import { localWebUrl, webCapture, type WebCapture } from './web-review-model.ts';

export interface WebReviewOptions {
  url:string;repoRoot:string;outDir:string;session:ReviewSession;hub:Hub;
  channel?:AgentChannel;reviewUrl:()=>string;
  /** Used by browser integration tests; ordinary launches always have a visible window. */
  browserArgs?:string[];
}
export function createWebReview(options:WebReviewOptions){
  const url=localWebUrl(options.url),origin=new URL(url).origin;
  let browser:Awaited<ReturnType<typeof launchReviewBrowser>>|null=null,sessionId='',contextId=0;
  let opening:Promise<void>|null=null,state='closed',detail='Open the review browser to annotate your UI.';
  let queue:Promise<unknown>=Promise.resolve();
  const key='__lcr_'+crypto.randomUUID().replaceAll('-',''),binding=key+'_send';
  const drafts=new Map<string,WebCapture>();
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
      return {capture:{...clean,page:attachRef(pageName),area:attachRef(areaName)},preview:'data:image/png;base64,'+area.data};
    }finally{await api('visible',true).catch(()=>{});}
  }
  async function publish(notes:any[]){
    options.hub.emit({type:'review',file:options.session.file});
    const channel=options.channel;
    if(!channel||(channel.available&&!channel.available()))return undefined;
    try{const delivery=await channel.publish(options.session.file,notes);
      return delivery.state==='failed'?'Saved, but forwarding failed: '+(delivery.error||'Retry AI from the full conversation.'):undefined;
    }catch(error){return 'Saved, but forwarding failed: '+String(error);}
  }
  async function action(name:string,payload:any){
    if(name==='notes')return {notes:(await options.session.read()).notes.filter(n=>n.web)};
    if(name==='capture'){
      const result=await screenshot(payload.capture);
      if(drafts.size>=30)drafts.delete(drafts.keys().next().value!);
      const draftId=crypto.randomUUID();drafts.set(draftId,result.capture);
      return {...result,draftId,saveLabel:options.channel&&(!options.channel.available||options.channel.available())?'Save & ask AI':'Save note'};
    }
    if(name==='save'){
      const capture=drafts.get(payload.draftId);
      const body=typeof payload.body==='string'?payload.body.trim():'';
      if(!capture||!body||body.length>100_000)throw new Error('A captured selection and a comment are required.');
      const id='|@|@|#'+crypto.randomUUID().replaceAll('-','').slice(0,12);
      const result=await options.session.save({comments:[{id,file:'',scope:'global',start:0,end:0,body,web:{before:capture,after:[]}}]});
      drafts.delete(payload.draftId);
      return {id,delivery:await publish(result.changed)};
    }
    if(name==='reply'){
      const doc=await options.session.read();
      if(!doc.notes.some(n=>n.id===payload.id&&n.web))throw new Error('That UI note no longer exists.');
      const body=typeof payload.body==='string'?payload.body.trim():'';
      if(!body||body.length>100_000)throw new Error('Write a reply first.');
      const note=await options.session.reply(payload.id,body);
      if(!note)throw new Error('That note was deleted.');
      return {delivery:await publish([note])};
    }
    if(name==='after'){
      const note=(await options.session.read()).notes.find(n=>n.id===payload.id);
      if(!note?.web)throw new Error('That UI note no longer exists.');
      const metadata=await api('prepare',note.web.before);
      const result=await screenshot(metadata);
      if(!await options.session.addWebCapture(note.id,result.capture))throw new Error('That note was deleted before the comparison was saved.');
      options.hub.emit({type:'review',file:options.session.file});
      return result;
    }
    if(name==='review'){
      // Open only lcr's own review URL, never a URL supplied by the reviewed page.
      if(!browser)throw new Error('Browser disconnected.');
      const ref=typeof payload.id==='string'?payload.id.split('|#').at(-1):'';
      await browser.cdp.send('Target.createTarget',{url:options.reviewUrl()+(ref?'#note='+encodeURIComponent(ref):'')});
      return {};
    }
    throw new Error('Unknown web review action.');
  }
  async function open(){
    if(opening)return opening;
    if(browser&&!browser.cdp.connected){await browser.close();browser=null;sessionId='';}
    if(browser&&sessionId){try{await browser.cdp.send('Target.activateTarget',{targetId:(await send('Target.getTargetInfo')).targetInfo.targetId});return;}catch{sessionId='';}}
    opening=(async()=>{
      state='opening';detail='Starting the review browser…';
      try{
        if(!browser){
          browser=await launchReviewBrowser(path.resolve(options.repoRoot,options.outDir,'.browser'),options.browserArgs);
          const launched=browser;
          void launched.child.exited.then(()=>{launched.cdp.close();if(browser!==launched)return;browser=null;sessionId='';state='closed';detail='The review browser closed. Reopen it to continue.';});
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
        state='ready';detail='Select Element, Block, Area or Point in the review browser.';
        listeners.push(cdp.on('Target.detachedFromTarget',event=>{if(event.sessionId===attachedSession&&sessionId===attachedSession){sessionId='';contextId=0;state='closed';detail='The reviewed tab closed. Open the review browser to continue.';}}));
      }catch(error){state='error';detail=error instanceof Error?error.message:String(error);if(browser){await browser.close();browser=null;}throw error;}
      finally{opening=null;}
    })();
    return opening;
  }
  return {status,open,async captureAfter(id:string){
    const work=()=>action('after',{id});const next=queue.then(work,work);queue=next.catch(()=>{});return next;
  },async focus(id:string){
    const note=(await options.session.read()).notes.find(n=>n.id===id);
    if(!note?.web)throw new Error('That UI note no longer exists.');
    await open();
    // Do not navigate automatically: restoring app state belongs to the reviewer.
    return api('focus',note.id);
  },async close(){unbind();const current=browser;browser=null;if(current)await current.close();}};
}
export type WebReviewController=ReturnType<typeof createWebReview>;
