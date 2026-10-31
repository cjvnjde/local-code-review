/** Runs in the reviewed page. Keep this function self-contained: its compiled source is injected by CDP. */
export function installPageReview(config: {key:string;binding:string;origin:string;reviewUrl:string}) {
  const win=globalThis as any;
  if(window!==window.top||location.origin!==config.origin||win[config.key]) return;
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',()=>installPageReview(config),{once:true});return;}
  const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  let sequence=0, mode='element', notes:any[]=[];
  let start:any=null, hovering:Element|null=null, busy=false;
  let frame:HTMLIFrameElement|null=null,activeToken='',frameDirty=false,panelGeneration=0;
  let expanded=false,launcherPress:any=null,suppressLauncherClick=false;
  const reviewOrigin=new URL(config.reviewUrl).origin;
  const host=document.createElement('div'); host.id=config.key;
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
    :host{all:initial;--fs-body:13px;--fs-small:11px;--tap:32px;--icon:16px;--row:36px;color:#e9eaf2;font:var(--fs-body)/1.5 system-ui,sans-serif}
    *{box-sizing:border-box}button,a{font:inherit}button,.review-link{min-width:var(--tap);min-height:var(--tap);border:1px solid #414553;background:#242733;color:inherit;border-radius:7px;padding:5px 10px;cursor:pointer}
    button:hover,.review-link:hover{background:#35394b}button:disabled{opacity:.55;cursor:wait}button[aria-pressed=true]{background:#7554df;border-color:#9779f1;color:white}.review-link{text-decoration:none}
    .launcher{pointer-events:auto;position:fixed;left:18px;bottom:18px;width:calc(var(--tap) + 12px);height:calc(var(--tap) + 12px);padding:0;border-radius:50%;background:#191c26;border-color:#9779f1;font-weight:700;touch-action:none;cursor:grab;box-shadow:0 6px 30px #0005}
    .launcher:active{cursor:grabbing}
    .bar{pointer-events:auto;position:fixed;display:flex;gap:5px;align-items:center;padding:8px;border:1px solid #444858;border-radius:13px;background:#191c26;box-shadow:0 6px 30px #0005;max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center}
    .brand{font-weight:700;padding:0 9px;color:#c6b7ff}
    .outline{position:fixed;pointer-events:none;border:2px solid #9f7cff;background:#9f7cff19;border-radius:3px;display:none}
    .label{position:absolute;bottom:100%;left:0;white-space:nowrap;padding:2px 7px;background:#7554df;color:white;font-size:var(--fs-small)}
    .dock{pointer-events:auto;position:fixed;right:18px;top:18px;bottom:78px;width:min(560px,calc(100vw - 36px));background:#191c26;border:1px solid #444858;box-shadow:0 8px 40px #0006;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
    .bar[hidden],.dock[hidden]{display:none}.head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #363a47}.head b{flex:1}.content{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto}.content iframe{width:100%;flex:1;min-height:0;border:0;background:#191c26}.status,.error{padding:10px 14px;margin:0}
    .pin{pointer-events:auto;position:fixed;border-radius:16px;background:#7554df;border:2px solid #fff;box-shadow:0 2px 8px #0007;color:white;font-weight:700;padding:0 6px;min-width:28px;min-height:28px}
    .error{color:#ffafa8;white-space:pre-wrap}
  </style><div class="outline"><span class="label"></span></div><div class="pins"></div>
  <div class="dock" hidden><div class="head"><b></b><button type="button" data-close aria-label="Close note panel">×</button></div><div class="content"></div></div>
  <button class="launcher" data-launcher aria-label="Open UI review tools" aria-expanded="false" title="Click or drag the page to annotate; hold Alt to interact. Click for tools and Browse; drag this circle to move.">lcr</button>
  <div class="bar" hidden><span class="brand">lcr · UI</span><button data-mode="browse">Browse</button><button data-mode="element" aria-pressed="true" title="Click the exact HTML element; drag to select an area">Element</button><button data-mode="block" title="Click a containing layout block; drag to select an area">Block</button><button data-mode="area">Area</button><button data-mode="point">Point</button><button data-notes>Notes · 0</button><a class="review-link" data-review target="lcr-review" rel="noopener">Review ↗</a></div>`;
  (document.body||document.documentElement).append(host);
  const $=(s:string)=>root.querySelector(s) as HTMLElement;
  const dock=$('.dock'),content=$('.content'),outline=$('.outline');
  const launcher=$('[data-launcher]'),bar=$('.bar');
  const positionKey='lcr:launcher:'+config.reviewUrl;
  let launcherPosition={x:18,y:innerHeight-62};
  try{const saved=JSON.parse(sessionStorage.getItem(positionKey)||'null');if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))launcherPosition=saved;}catch{}
  function positionLauncher(){
    const size=launcher.offsetWidth;
    launcherPosition.x=Math.max(12,Math.min(innerWidth-size-12,launcherPosition.x));
    launcherPosition.y=Math.max(12,Math.min(innerHeight-size-12,launcherPosition.y));
    launcher.style.left=launcherPosition.x+'px';launcher.style.top=launcherPosition.y+'px';launcher.style.bottom='auto';
    bar.style.left=Math.max(12,Math.min(innerWidth-bar.offsetWidth-12,launcherPosition.x))+'px';
    const above=launcherPosition.y-bar.offsetHeight-8;
    bar.style.top=Math.max(12,Math.min(innerHeight-bar.offsetHeight-12,above>=12?above:launcherPosition.y+size+8))+'px';
  }
  function expand(value:boolean){
    if(value===expanded)return;
    if(!dock.hidden&&!close())return;
    expanded=value;bar.hidden=!value;
    launcher.setAttribute('aria-expanded',String(value));launcher.setAttribute('aria-label',value?'Hide UI review tools':'Open UI review tools');
    positionLauncher();
  }
  function rpc(action:string,payload:any={}):Promise<any>{
    const seq=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(pending.delete(seq))reject(new Error('lcr did not respond. Check the review server.'));},30000);
      pending.set(seq,{resolve,reject,timer});
      win[config.binding](JSON.stringify({seq,action,payload}));
    });
  }
  function error(e:any){
    if(dock.hidden){dock.hidden=false;$('.head b').textContent='UI review';}
    let node=$('.error');if(!node){node=document.createElement('p');node.className='error';node.setAttribute('role','alert');content.append(node);}node.textContent=e instanceof Error?e.message:String(e);
  }
  function close(){
    if(frameDirty&&!confirm('Discard the note changes you are writing?'))return false;
    panelGeneration++;frame=null;activeToken='';frameDirty=false;
    dock.hidden=true;content.textContent='';start=null;hovering=null;outline.style.display='none';return true;
  }
  function setMode(value:string){
    if(!dock.hidden&&!close())return;
    mode=value;start=null;hovering=null;outline.style.display='none';
    root.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.mode===mode)));
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
  function ours(e:Event){return e.composedPath().includes(host);}
  function stop(e:Event){e.preventDefault();e.stopImmediatePropagation();}
  function showFrame(kind:'draft'|'note',token:string){
    content.textContent='';activeToken=token;frameDirty=false;
    const status=document.createElement('p');status.className='status';status.textContent='Loading review editor…';content.append(status);
    const editor=document.createElement('iframe');
    frame=editor;editor.title=kind==='draft'?'New visual review note':'Visual review conversation';
    editor.allow='clipboard-read; clipboard-write';
    editor.src=config.reviewUrl+'/?ui-'+kind+'='+encodeURIComponent(token);
    editor.onload=()=>{if(frame===editor)status.remove();};
    editor.onerror=()=>{if(frame===editor){status.remove();error(new Error('The review editor could not load. Open Review to continue.'));}};
    content.append(editor);
  }
  async function choose(el:Element|null,r:any,kind=mode){
    if(busy||!close())return;
    const generation=panelGeneration;
    const capture=metadata(el,r,kind);
    dock.hidden=false;$('.head b').textContent='New visual note';
    const status=document.createElement('p');status.className='status';status.textContent='Capturing page and selected area…';content.append(status);
    busy=true;
    try{
      const result=await rpc('capture',{capture});
      if(generation!==panelGeneration)return;
      if(typeof result.draftId!=='string'||!result.draftId)throw new Error('The page capture did not return a draft.');
      showFrame('draft',result.draftId);
    }catch(e){
      if(generation!==panelGeneration)return;
      status.remove();error(e);
      const retry=document.createElement('button');retry.textContent='Retry capture';retry.onclick=()=>{void choose(el,r,kind);};content.append(retry);
    }finally{busy=false;}
  }
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.origin!==reviewOrigin||!frame||event.source!==frame.contentWindow||!message||message.type!=='lcr:ui'||message.token!==activeToken)return;
    if(message.action==='dirty'){if(typeof message.dirty==='boolean')frameDirty=message.dirty;}
    else if(message.action==='close'){frameDirty=false;close();void refresh().catch(()=>{});}
    else if(message.action==='review'&&(message.id===undefined||(typeof message.id==='string'&&message.id))){void rpc('review',message.id===undefined?{}:{id:message.id}).catch(error);}
  });
  document.addEventListener('securitypolicyviolation',event=>{
    if(frame&&event.effectiveDirective==='frame-src'&&event.blockedURI.startsWith(reviewOrigin))error(new Error('This page blocks the review editor in a frame. Open Review to continue.'));
  });
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
      b.setAttribute('aria-label','UI note '+(i+1)+': '+n.body.slice(0,120));b.style.left=Math.max(0,Math.min(innerWidth-32,r.x))+'px';b.style.top=Math.max(0,Math.min(innerHeight-32,r.y))+'px';
      b.onclick=()=>showNote(n.id);container.append(b);
    });
  }
  function showNote(id:string){
    const n=notes.find(n=>n.id===id);if(!n||busy||!close())return;
    dock.hidden=false;$('.head b').textContent='Visual note '+(notes.indexOf(n)+1);
    showFrame('note',id);
  }
  async function refresh(){const result=await rpc('notes');notes=result.notes;$('[data-notes]').textContent='Notes · '+notes.length;pins();}
  root.querySelectorAll('[data-mode]').forEach(b=>(b as HTMLElement).onclick=()=>setMode((b as HTMLElement).dataset.mode!));
  $('[data-notes]').onclick=()=>{void rpc('review').catch(error);};
  const reviewLink=$('[data-review]') as HTMLAnchorElement;reviewLink.href=config.reviewUrl;
  reviewLink.onclick=e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();void rpc('review').catch(error);};
  $('[data-close]').onclick=close;
  launcher.onpointerdown=e=>{
    if(e.button!==0)return;
    suppressLauncherClick=false;launcherPress={id:e.pointerId,x:e.clientX,y:e.clientY,origin:{...launcherPosition},moved:false};
    launcher.setPointerCapture(e.pointerId);e.preventDefault();
  };
  launcher.onpointermove=e=>{
    if(!launcherPress||e.pointerId!==launcherPress.id)return;
    const dx=e.clientX-launcherPress.x,dy=e.clientY-launcherPress.y;
    if(Math.hypot(dx,dy)>6)launcherPress.moved=true;
    if(!launcherPress.moved)return;
    launcherPosition={x:launcherPress.origin.x+dx,y:launcherPress.origin.y+dy};positionLauncher();
  };
  function endLauncher(){
    if(!launcherPress)return;
    suppressLauncherClick=launcherPress.moved;launcherPress=null;
    try{sessionStorage.setItem(positionKey,JSON.stringify(launcherPosition));}catch{}
  }
  launcher.onpointerup=endLauncher;launcher.onpointercancel=endLauncher;
  launcher.onclick=()=>{if(suppressLauncherClick){suppressLauncherClick=false;return;}expand(!expanded);};
  function areaRect(a:any,x:number,y:number){return clamp({x:Math.min(a.x,x),y:Math.min(a.y,y),width:Math.max(1,Math.abs(a.x-x)),height:Math.max(1,Math.abs(a.y-y))});}
  document.addEventListener('pointermove',e=>{
    if(e.altKey){outline.style.display='none';return;}
    if(mode==='browse'||busy||ours(e))return;
    if(start){
      if(mode!=='point'&&Math.hypot(start.x-e.clientX,start.y-e.clientY)>6)start.area=true;
      if(start.area){paint(areaRect(start,e.clientX,e.clientY),'Area');return;}
      return;
    }
    hovering=target(e);if(hovering&&(mode==='element'||mode==='block'))paint(rect(hovering),hovering.localName);
  },true);
  document.addEventListener('pointerdown',e=>{
    if(mode==='browse'||busy||ours(e)||e.altKey||e.button!==0)return;
    stop(e);const el=target(e);
    if(!dock.hidden&&!close())return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId,el,area:mode==='area'};
  },true);
  document.addEventListener('pointerup',e=>{
    if(!start||e.pointerId!==start.id)return;
    const a=start;start=null;
    if(mode==='browse'||busy||ours(e)||e.altKey)return;
    stop(e);
    if(mode==='point'){void choose(null,clamp({x:e.clientX-48,y:e.clientY-48,width:96,height:96}));return;}
    if(a.area||Math.hypot(a.x-e.clientX,a.y-e.clientY)>6)void choose(null,areaRect(a,e.clientX,e.clientY),'area');
    else {const el=target(e)||a.el;if(el)void choose(el,rect(el));}
  },true);
  for(const type of ['click','dblclick','contextmenu'])document.addEventListener(type,e=>{if(mode!=='browse'&&!ours(e)&&!(e as MouseEvent).altKey)stop(e);},true);
  document.addEventListener('pointercancel',()=>{start=null;outline.style.display='none';},true);
  window.addEventListener('blur',()=>{start=null;outline.style.display='none';endLauncher();});
  window.addEventListener('beforeunload',e=>{if(frameDirty||busy){e.preventDefault();e.returnValue='';}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Alt'){start=null;outline.style.display='none';}
    if(e.key==='Escape'){stop(e);if(!dock.hidden){close();return;}if(mode!=='browse'){setMode('browse');return;}expand(false);}
  },true);
  let scheduled=false;function schedulePins(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;pins();});}
  window.addEventListener('scroll',schedulePins,true);window.addEventListener('resize',()=>{positionLauncher();schedulePins();});
  win[config.key]={
    resolve(seq:number,result:any){const call=pending.get(seq);if(!call)return;pending.delete(seq);clearTimeout(call.timer);result.ok?call.resolve(result.value):call.reject(new Error(result.error));},
    async visible(value:boolean){host.style.visibility=value?'visible':'hidden';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},
    async focus(id:string){await refresh();const n=notes.find(n=>n.id===id);if(!n)throw new Error('That UI note no longer exists.');if(busy||!close())return;const p=locate(n.web.before);if(p?.el)p.el.scrollIntoView({block:'center'});showNote(id);},
    prepare(c:any){const p=locate(c);if(!p)throw new Error('The original element or viewport cannot be matched. Restore the original URL, viewport and page state, or create a new note.');
      if(p.el)p.el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      return new Promise(resolve=>requestAnimationFrame(()=>{const r=p.el?rect(p.el):p.rect;resolve(metadata(p.el,clamp(r),c.mode));}));},
  };
  positionLauncher();void refresh().catch(error);setInterval(()=>{void refresh().catch(()=>{});},2000);
}
