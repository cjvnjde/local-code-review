/** Runs in the reviewed page. Keep this function self-contained: its compiled source is injected by CDP. */
export function installPageReview(config: {key:string;binding:string;origin:string;reviewUrl:string}) {
  const win=globalThis as any;
  if(window!==window.top||location.origin!==config.origin||win[config.key]) return;
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>installPageReview(config),{once:true});return;}
  const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  let draftId='';
  let sequence=0, mode='browse', notes:any[]=[], selected:any=null, capture:any=null;
  let start:any=null, hovering:Element|null=null, draft=false, busy=false, currentId='', signature='',deferred=false;
  const host=document.createElement('div'); host.id=config.key;
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
    :host{all:initial;--fs-body:13px;--fs-small:11px;--tap:32px;--icon:16px;--row:36px;color:#e9eaf2;font:var(--fs-body)/1.5 system-ui,sans-serif}
    *{box-sizing:border-box}button,textarea{font:inherit}button{min-width:var(--tap);min-height:var(--tap);border:1px solid #414553;background:#242733;color:inherit;border-radius:7px;padding:5px 10px;cursor:pointer}
    button:hover{background:#35394b}button:disabled{opacity:.55;cursor:wait}button[aria-pressed=true],.primary{background:#7554df;border-color:#9779f1;color:white}
    .bar{pointer-events:auto;position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:5px;align-items:center;padding:8px;border:1px solid #444858;border-radius:13px;background:#191c26;box-shadow:0 6px 30px #0005;max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center}
    .brand{font-weight:700;padding:0 9px;color:#c6b7ff}.hint{position:fixed;bottom:83px;left:50%;transform:translateX(-50%);padding:5px 12px;border-radius:6px;background:#191c26;color:#c9cbd9;font-size:var(--fs-small);max-width:90vw;text-align:center}
    .glass{position:fixed;inset:0;pointer-events:auto;cursor:crosshair}.glass[hidden]{display:none}
    .outline{position:fixed;pointer-events:none;border:2px solid #9f7cff;background:#9f7cff19;border-radius:3px;display:none}
    .label{position:absolute;bottom:100%;left:0;white-space:nowrap;padding:2px 7px;background:#7554df;color:white;font-size:var(--fs-small)}
    .dock{pointer-events:auto;position:fixed;right:18px;top:18px;bottom:96px;width:min(380px,calc(100vw - 36px));background:#191c26;border:1px solid #444858;box-shadow:0 8px 40px #0006;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
    .dock[hidden],.hint[hidden]{display:none}.head{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid #363a47}.head b{flex:1}.content{overflow:auto;padding:14px;flex:1;min-height:0}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
    textarea{width:100%;min-height:120px;resize:vertical;color:inherit;background:#10131c;border:1px solid #555969;border-radius:7px;padding:10px;outline-color:#ad8dff}
    .meta{font-size:var(--fs-small);color:#acb1c3;overflow-wrap:anywhere;margin-bottom:10px}.message{white-space:pre-wrap;overflow-wrap:anywhere;border-left:2px solid #4f5365;padding:8px 10px;margin:10px 0}.message.agent{border-color:#a587f8}.message b{display:block;color:#b9a3f9;font-size:var(--fs-small);margin-bottom:4px}
    .list{display:block;width:100%;text-align:left;margin-bottom:8px;white-space:pre-wrap;overflow-wrap:anywhere}.preview{width:100%;border:1px solid #414553;border-radius:6px;margin:8px 0}.status{color:#d4c5ff;font-size:var(--fs-small)}
    .pin{pointer-events:auto;position:fixed;border-radius:16px;background:#7554df;border:2px solid #fff;box-shadow:0 2px 8px #0007;color:white;font-weight:700;padding:0 6px;min-width:28px;min-height:28px}
    .error{color:#ffafa8;white-space:pre-wrap}.subtle{font-size:var(--fs-small);color:#adb1c3}
  </style><div class="glass" hidden></div><div class="outline"><span class="label"></span></div><div class="pins"></div>
  <div class="hint" hidden></div><div class="dock" hidden><div class="head"><b></b><button type="button" data-close aria-label="Close note panel">×</button></div><div class="content"></div></div>
  <div class="bar"><span class="brand">lcr · UI</span><button data-mode="browse" aria-pressed="true">Browse</button><button data-mode="element">Element</button><button data-mode="block">Block</button><button data-mode="area">Area</button><button data-mode="point">Point</button><button data-notes>Notes · 0</button><button data-review>Review ↗</button></div>`;
  (document.body||document.documentElement).append(host);
  const $=(s:string)=>root.querySelector(s) as HTMLElement;
  const dock=$('.dock'),content=$('.content'),outline=$('.outline'),hint=$('.hint'),glass=$('.glass');
  const safe=(v:unknown)=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
  function rpc(action:string,payload:any={}):Promise<any>{
    const seq=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(pending.delete(seq))reject(new Error('lcr did not respond. Check the review server.'));},30000);
      pending.set(seq,{resolve,reject,timer});
      win[config.binding](JSON.stringify({seq,action,payload}));
    });
  }
  function error(e:any){let node=$('.error');if(!node){node=document.createElement('p');node.className='error';content.append(node);}node.textContent=e.message||String(e);}
  function dirty(){return !!(root.querySelector('textarea') as HTMLTextAreaElement)?.value.trim();}
  function leave(){return !busy&&(!dirty()||confirm('Discard the comment you are writing?'));}
  function close(){if(!leave())return;draft=false;dock.hidden=true;currentId='';selected=null;capture=null;outline.style.display='none';}
  function setMode(value:string){
    if((draft||dirty())&&!leave())return;
    if(draft||dirty()){draft=false;dock.hidden=true;currentId='';selected=null;capture=null;}
    mode=value;start=null;hovering=null;outline.style.display='none';glass.hidden=mode==='browse';$('.pins').style.display=mode==='browse'?'':'none';
    root.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.mode===mode)));
    hint.textContent=mode==='area'?'Drag a rectangle. Escape returns to browsing.':mode==='point'?'Click a location. Escape returns to browsing.':mode==='block'?'Click a layout block. Alt + wheel changes the parent.':mode==='element'?'Click an element. Alt + wheel selects its parent.':'';
    hint.hidden=mode==='browse';
  }
  function rect(el:Element){const r=el.getBoundingClientRect();return clamp({x:r.x,y:r.y,width:r.width,height:r.height});}
  function clamp(r:any){const x=Math.max(0,Math.min(innerWidth-1,r.x)),y=Math.max(0,Math.min(innerHeight-1,r.y));return {x,y,width:Math.max(1,Math.min(innerWidth,r.x+r.width)-x),height:Math.max(1,Math.min(innerHeight,r.y+r.height)-y)};}
  function paint(r:any,label=''){outline.style.cssText='display:block;left:'+r.x+'px;top:'+r.y+'px;width:'+r.width+'px;height:'+r.height+'px';$('.label').textContent=label;}
  function selector(el:Element){
    const parts:string[]=[];
    for(let e:Element|null=el;e&&parts.length<12;e=e.parentElement){
      let part=e.localName;
      if(e.id)part+='#'+CSS.escape(e.id);
      else if(e.hasAttribute('data-testid'))part+='[data-testid="'+CSS.escape(e.getAttribute('data-testid')!)+'"]';
      else {const siblings=e.parentElement?[...e.parentElement.children].filter(n=>n.localName===e!.localName):[];if(siblings.length>1)part+=':nth-of-type('+(siblings.indexOf(e)+1)+')';}
      parts.unshift(part);const result=parts.join(' > ');
      if(document.querySelectorAll(result).length===1&&document.querySelector(result)===el)return result;
    }
    return '';
  }
  function components(el:any){
    const found:any[]=[];const seen=new Set();
    function add(framework:string,name:any,source?:any){if(typeof name!=='string'||!name||found.length>=30)return;const key=framework+name;if(seen.has(key))return;seen.add(key);found.push({framework,name:name.slice(0,200),...(typeof source?.fileName==='string'?{file:source.fileName.slice(0,1000)}:{}),...(Number.isSafeInteger(source?.lineNumber)?{line:source.lineNumber}:{})});}
    // Runtime handles are best-effort and read only. Never collect component props or state.
    try{
      let node=el, fiber:any;
      for(let i=0;node&&i<20&&!fiber;i++,node=node.parentElement){const key=Object.keys(node).find(k=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$'));if(key)fiber=node[key];}
      for(let i=0;fiber&&i<60;i++,fiber=fiber.return){const t=fiber.type;if(t&&typeof t!=='string')add('React',t.displayName||t.name||t.render?.displayName||t.render?.name||t.type?.displayName||t.type?.name,fiber._debugSource);}
    }catch{}
    try{
      let node=el,component:any;
      for(let i=0;node&&i<20&&!component;i++,node=node.parentElement)component=node.__vueParentComponent||node.__vue__;
      for(let i=0;component&&i<30;i++,component=component.parent||component.$parent){const t=component.type||component.$options;add('Vue',t?.name||t?.__name,t?.__file?{fileName:t.__file}:undefined);}
    }catch{}
    return found;
  }
  function metadata(el:Element|null,r:any,kind=mode){
    const attributes:Record<string,string>={},styles:Record<string,string>={};
    if(el){
      for(const name of ['id','class','role','aria-label','title','data-testid','name','type','placeholder','alt']){const v=el.getAttribute(name);if(v)attributes[name]=v.slice(0,1000);}
      const css=getComputedStyle(el);for(const name of ['display','position','width','height','color','background-color','font-family','font-size','font-weight','line-height','padding','margin','gap','border','border-radius','align-items','justify-content'])styles[name]=css.getPropertyValue(name).slice(0,1000);
    }
    return {url:location.href,title:document.title,at:new Date().toISOString(),mode:kind,rect:r,
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},scroll:{x:scrollX,y:scrollY},
      ...(el?{selector:selector(el),element:{tag:el.localName,text:((el as HTMLElement).innerText||el.textContent||'').trim().slice(0,2000),attributes,styles}}:{}),components:el?components(el):[]};
  }
  function target(event:any){let el=document.elementsFromPoint(event.clientX,event.clientY).find(n=>n!==host);if(!el)return null;
    if(mode==='block')for(let i=0;el.parentElement&&i<12;i++){if(['block','flex','grid','table','list-item'].includes(getComputedStyle(el).display)&&el.getBoundingClientRect().width>40)break;el=el.parentElement;}
    return el;
  }
  function ours(e:Event){return e.composedPath().includes(host)&&!e.composedPath().includes(glass);}
  function stop(e:Event){e.preventDefault();e.stopImmediatePropagation();}
  function metaHtml(c:any){return '<div class="meta">'+safe(c.element?.tag||c.mode)+' · '+safe(c.rect.width.toFixed(0)+' × '+c.rect.height.toFixed(0))+'<br>'+safe(c.components.map((x:any)=>x.framework+' '+x.name).join(' → ')||c.selector||'Screen region')+'</div>';}
  async function choose(el:Element|null,r:any){
    if(busy||draft)return;
    selected=metadata(el,r);draft=true;currentId='';dock.hidden=false;$('.head b').textContent='New UI note';
    content.innerHTML=metaHtml(selected)+'<p class="subtle">Capturing page and selected area…</p>';
    busy=true;
    try{
      const result=await rpc('capture',{capture:selected});capture=result.capture;draftId=result.draftId;
      content.innerHTML=metaHtml(capture)+'<img class="preview" alt="Selected area at capture time" src="'+safe(result.preview)+'">'+
        '<textarea aria-label="UI review comment" placeholder="What should change here?"></textarea><div class="actions"><button class="primary" data-save>'+safe(result.saveLabel)+'</button><button data-cancel>Cancel</button></div>';
      (root.querySelector('textarea') as HTMLTextAreaElement).focus();
      $('[data-cancel]').onclick=close;
      $('[data-save]').onclick=async()=>{
        const body=(root.querySelector('textarea') as HTMLTextAreaElement).value.trim();if(!body||busy)return;
        busy=true;($('[data-save]') as HTMLButtonElement).disabled=true;
        try{const saved=await rpc('save',{draftId,body});draft=false;capture=null;selected=null;setMode('browse');await refresh();showNote(saved.id);if(saved.delivery)error(new Error(saved.delivery));}
        catch(e){error(e);}finally{busy=false;const button=$('[data-save]') as HTMLButtonElement;if(button)button.disabled=false;}
      };
    }catch(e){error(e);const retry=document.createElement('button');retry.textContent='Retry capture';retry.onclick=()=>{draft=false;void choose(el,r);};content.append(retry);}
    finally{busy=false;}
  }
  function locate(c:any){
    if(c.url!==location.href)return null;
    if(c.element&&!c.selector)return null;
    if(c.selector){
      try{const matches=document.querySelectorAll(c.selector);if(matches.length!==1)return null;
        const el=matches[0] as HTMLElement;
        if(el.localName!==c.element?.tag)return null;
        const attr=c.element.attributes;
        for(const key of ['id','data-testid','role','aria-label','name'])if(attr[key]&&el.getAttribute(key)!==attr[key])return null;
        if(!attr.id&&!attr['data-testid']&&(el.innerText||el.textContent||'').trim().slice(0,2000)!==c.element.text)return null;
        return {el,rect:rect(el)};
      }catch{return null;}
    }
    if(innerWidth!==c.viewport.width||innerHeight!==c.viewport.height)return null;
    const r={...c.rect,x:c.rect.x+c.scroll.x-scrollX,y:c.rect.y+c.scroll.y-scrollY};
    return {el:null,rect:r};
  }
  function pins(){
    const container=$('.pins');container.textContent='';
    notes.forEach((n,i)=>{const p=locate(n.web.before);if(!p)return;const r=p.rect;
      if(r.y+r.height<0||r.y>innerHeight||r.x+r.width<0||r.x>innerWidth)return;
      const b=document.createElement('button');b.className='pin';b.textContent=String(i+1);b.title=n.body;
      b.setAttribute('aria-label','UI note '+(i+1)+': '+n.body.slice(0,120));b.style.left=Math.max(0,Math.min(innerWidth-32,r.x))+'px';b.style.top=Math.max(0,r.y)+'px';
      b.onclick=()=>{if(!leave())return;draft=false;setMode('browse');showNote(n.id);};container.append(b);
    });
  }
  function showNote(id:string){
    const n=notes.find(n=>n.id===id);if(!n)return;
    draft=false;currentId=id;dock.hidden=false;$('.head b').textContent='UI note '+(notes.indexOf(n)+1);
    content.innerHTML=metaHtml(n.web.before)+'<div class="status">'+safe(n.status+(n.detail?' · '+n.detail:''))+'</div><div class="message">'+safe(n.body)+'</div>'+
      n.messages.map((m:any)=>'<div class="message '+(m.role==='agent'?'agent':'')+'"><b>'+safe(m.role==='agent'?'AI':'You')+'</b>'+safe(m.body)+'</div>').join('')+
      '<textarea aria-label="Reply to UI note" placeholder="Reply or ask a follow-up…"></textarea><div class="actions"><button class="primary" data-reply>Reply</button><button data-after>Capture after</button><button data-open>Full conversation ↗</button></div><p class="subtle">'+n.web.after.length+' comparison capture'+(n.web.after.length===1?'':'s')+' · Full screenshots and comparison are in the review.</p>';
    $('[data-reply]').onclick=async()=>{const ta=root.querySelector('textarea') as HTMLTextAreaElement;const body=ta.value.trim();if(!body||busy)return;busy=true;
      try{const result=await rpc('reply',{id,body});if(ta.value.trim()===body)ta.value='';await refresh();if(!dirty())showNote(id);if(result.delivery)error(new Error(result.delivery));}catch(e){error(e);}finally{busy=false;}};
    $('[data-after]').onclick=async()=>{if(busy)return;busy=true;
      try{const result=await rpc('after',{id});await refresh();if(!dirty())showNote(id);const p=document.createElement('p');p.textContent='Comparison saved. Open the full conversation to compare.';content.append(p);}
      catch(e){error(e);}finally{busy=false;}};
    $('[data-open]').onclick=()=>{void rpc('review',{id}).catch(error);};
  }
  function list(){
    if(!leave())return;draft=false;currentId='';dock.hidden=false;$('.head b').textContent='UI notes';
    content.innerHTML=notes.map((n,i)=>'<button class="list" data-id="'+safe(n.id)+'"><b>'+safe((i+1)+'. '+n.status)+'</b><br>'+safe(n.body.slice(0,180))+'</button>').join('')||'<p>Choose Element, Block, Area or Point to leave your first note.</p>';
    content.querySelectorAll('[data-id]').forEach(b=>(b as HTMLElement).onclick=()=>showNote((b as HTMLElement).dataset.id!));
  }
  async function refresh(){const result=await rpc('notes');notes=result.notes;const next=JSON.stringify(notes);$('[data-notes]').textContent='Notes · '+notes.length;pins();
    if(next!==signature||deferred){if(!draft&&!dirty()&&currentId){if(notes.some(n=>n.id===currentId))showNote(currentId);else{currentId='';dock.hidden=true;}deferred=false;}else deferred=true;}signature=next;}
  root.querySelectorAll('[data-mode]').forEach(b=>(b as HTMLElement).onclick=()=>setMode((b as HTMLElement).dataset.mode!));
  $('[data-notes]').onclick=list;$('[data-review]').onclick=()=>{void rpc('review').catch(error);};$('[data-close]').onclick=close;
  document.addEventListener('pointermove',e=>{
    if(mode==='browse'||draft||ours(e)||e.altKey)return;
    if(start&&mode==='area'){paint(clamp({x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(start.x-e.clientX),height:Math.abs(start.y-e.clientY)}),'Area');return;}
    hovering=target(e);if(hovering&&(mode==='element'||mode==='block'))paint(rect(hovering),hovering.localName);
  },true);
  document.addEventListener('pointerdown',e=>{if(mode==='browse'||draft||ours(e)||e.altKey||e.button!==0)return;stop(e);start={x:e.clientX,y:e.clientY};if(mode==='element'||mode==='block'){const el=hovering||target(e);if(el)void choose(el,rect(el));}},true);
  document.addEventListener('pointerup',e=>{if(!start||ours(e))return;const a=start;start=null;if(mode==='browse'||draft)return;stop(e);
    if(mode==='area')void choose(null,clamp({x:Math.min(a.x,e.clientX),y:Math.min(a.y,e.clientY),width:Math.max(1,Math.abs(a.x-e.clientX)),height:Math.max(1,Math.abs(a.y-e.clientY))}));
    if(mode==='point')void choose(null,clamp({x:e.clientX-48,y:e.clientY-48,width:96,height:96}));
  },true);
  for(const type of ['click','dblclick','contextmenu'])document.addEventListener(type,e=>{if(mode!=='browse'&&!ours(e)&&!(e as MouseEvent).altKey)stop(e);},true);
  document.addEventListener('pointercancel',()=>{start=null;outline.style.display='none';},true);
  window.addEventListener('blur',()=>{start=null;});
  document.addEventListener('wheel',e=>{if(!e.altKey||!hovering||!['element','block'].includes(mode)||draft)return;stop(e);if(hovering.parentElement)hovering=hovering.parentElement;paint(rect(hovering),hovering.localName);},{capture:true,passive:false});
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(ours(e))stop(e);if(!dock.hidden){close();return;}setMode('browse');}},true);
  let scheduled=false;function schedulePins(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;pins();});}
  window.addEventListener('scroll',schedulePins,true);window.addEventListener('resize',schedulePins);
  win[config.key]={
    resolve(seq:number,result:any){const call=pending.get(seq);if(!call)return;pending.delete(seq);clearTimeout(call.timer);result.ok?call.resolve(result.value):call.reject(new Error(result.error));},
    async visible(value:boolean){host.style.visibility=value?'visible':'hidden';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},
    async focus(id:string){await refresh();const n=notes.find(n=>n.id===id);if(!n)throw new Error('That UI note no longer exists.');if(!leave())return;draft=false;const p=locate(n.web.before);if(p?.el)p.el.scrollIntoView({block:'center'});setMode('browse');showNote(id);},
    prepare(c:any){const p=locate(c);if(!p)throw new Error('The original element or viewport cannot be matched. Restore the original URL, viewport and page state, or create a new note.');
      if(p.el)p.el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      return new Promise(resolve=>requestAnimationFrame(()=>{const r=p.el?rect(p.el):p.rect;resolve(metadata(p.el,clamp(r),c.mode));}));},
  };
  void refresh().catch(error);setInterval(()=>{void refresh().catch(()=>{});},2000);
}
