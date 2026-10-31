/** Evidence is immutable; another capture adds an observation rather than replacing the before. */
export interface WebCapture {
  url: string; title: string; at: string;
  mode: 'element'|'block'|'area'|'point';
  rect: {x: number; y: number; width: number; height: number};
  viewport: {width: number; height: number; dpr: number};
  scroll: {x: number; y: number};
  page: string; area: string;
  selector?: string;
  element?: {tag: string; text: string; attributes: Record<string,string>; styles: Record<string,string>};
  components: {framework: 'React'|'Vue'; name: string; file?: string; line?: number}[];
  selections?: {
    rect: WebCapture['rect'];
    selector?: string;
    element?: WebCapture['element'];
    components: WebCapture['components'];
  }[];
}
export interface WebReview { before: WebCapture; after: WebCapture[]; additional?: WebCapture[] }
const finite=(v: unknown): v is number=>typeof v==='number'&&Number.isFinite(v);
const ref=(v: unknown): v is string=>typeof v==='string'&&/^images\/[a-z0-9][a-z0-9._-]*\.png$/i.test(v);
const record=(v: unknown): v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function localWebUrl(raw: string): string {
  let url: URL;
  try { url=new URL(raw); } catch { throw new Error('--web requires a localhost HTTP(S) URL.'); }
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)
    throw new Error('--web requires a localhost HTTP(S) URL without credentials.');
  return url.href;
}
export function webCapture(value: unknown): WebCapture|null {
  if(!record(value)||typeof value.url!=='string'||typeof value.title!=='string'||typeof value.at!=='string'||
    !Number.isFinite(Date.parse(value.at))||typeof value.mode!=='string'||!['element','block','area','point'].includes(value.mode)) return null;
  try { localWebUrl(value.url); } catch { return null; }
  const r=value.rect,v=value.viewport,s=value.scroll;
  if(!record(v)||!record(s)||!finite(v.width)||!finite(v.height)||!finite(v.dpr)||!finite(s.x)||!finite(s.y)||
    v.width<=0||v.height<=0||v.dpr<=0||!ref(value.page)||!ref(value.area))return null;
  const width=v.width,height=v.height;
  const rect=(r: unknown): r is WebCapture['rect']=>record(r)&&finite(r.x)&&finite(r.y)&&finite(r.width)&&finite(r.height)&&
    r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=width+1&&r.y+r.height<=height+1;
  const strings=(value: unknown): value is Record<string,string>=>record(value)&&
    Object.entries(value).length<=50&&Object.values(value).every(x=>typeof x==='string'&&x.length<=4000);
  const metadata=(target: unknown): target is Pick<WebCapture,'selector'|'element'|'components'>=>{
    if(!record(target))return false;
    const element=target.element;
    if(element!=null&&(!record(element)||typeof element.tag!=='string'||
      typeof element.text!=='string'||!strings(element.attributes)||!strings(element.styles)))return false;
    if(target.selector!=null&&typeof target.selector!=='string')return false;
    return Array.isArray(target.components)&&target.components.length<=30&&Array.from(target.components).every((c: unknown)=>
      record(c)&&typeof c.framework==='string'&&['React','Vue'].includes(c.framework)&&typeof c.name==='string'&&
      (c.file==null||typeof c.file==='string')&&(c.line==null||(typeof c.line==='number'&&Number.isSafeInteger(c.line)&&c.line>=0)));
  };
  if(!rect(r)||!metadata(value))return null;
  const cleanMetadata=(target: Pick<WebCapture,'selector'|'element'|'components'>)=>({
    ...(target.selector?{selector:target.selector}:{}),
    ...(target.element?{element:{tag:target.element.tag,text:target.element.text,attributes:target.element.attributes,styles:target.element.styles}}:{}),
    components:target.components.map(c=>({framework:c.framework,name:c.name,...(c.file?{file:c.file}:{}),...(c.line!=null?{line:c.line}:{})})),
  });
  const selections: NonNullable<WebCapture['selections']>=[];
  if(value.selections!==undefined){
    if(!Array.isArray(value.selections)||value.selections.length<1||value.selections.length>100)return null;
    for(const selection of value.selections){
      if(!record(selection)||!metadata(selection)||!rect(selection.rect))return null;
      const r=selection.rect;
      selections.push({rect:{x:r.x,y:r.y,width:r.width,height:r.height},...cleanMetadata(selection)});
    }
  }
  // Detach and whitelist, including nested records, before asynchronous storage or rendering.
  return JSON.parse(JSON.stringify({url:value.url,title:value.title,at:value.at,mode:value.mode,
    rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:v.width,height:v.height,dpr:v.dpr},
    scroll:{x:s.x,y:s.y},page:value.page,area:value.area,...cleanMetadata(value),
    ...(value.selections!==undefined?{selections}:{}),
  }));
}
export function webReview(value: unknown): WebReview|null {
  if(!record(value))return null;
  const before=webCapture(value.before);
  if(!before||!Array.isArray(value.after)||value.after.length>100) return null;
  const after=Array.from(value.after,webCapture);
  if(!after.every((capture): capture is WebCapture=>capture!==null))return null;
  if(value.additional===undefined)return {before,after};
  if(!Array.isArray(value.additional)||value.additional.length>100)return null;
  const additional=Array.from(value.additional,webCapture);
  return additional.every((capture): capture is WebCapture=>capture!==null)?{before,after,additional}:null;
}
/** Human-readable evidence and a sealed machine-readable copy both travel in ordinary Markdown. */
export function webReviewLines(web: WebReview): string[] {
  web = webReview(web)!;
  const json=JSON.stringify(web).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const lines=['<!-- lcr:web '+json+' -->','','UI capture: '+web.before.mode+' selection. Metadata and screenshots record the page at capture time.',''];
  const captures=[{capture:web.before,label:'Before'},
    ...(web.additional??[]).map((capture,i)=>({capture,label:'Selection '+(i+2)})),
    ...web.after.map((capture,i)=>({capture,label:'After '+(i+1)}))];
  captures.forEach(({capture:c,label})=>{
    const data=JSON.stringify({...c,page:undefined,area:undefined},null,2);
    const fence='`'.repeat(Math.max(3,...(data.match(/`+/g)||[]).map(s=>s.length+1)));
    const imageLabel=label.startsWith('After ')?'After':label;
    lines.push(label==='Before'?'Before capture:':label.startsWith('After ')?'After capture '+label.slice(6)+':':label+':', '',fence+'json',data,fence,'',
      '!['+imageLabel+' — page]('+c.page+')','',
      '!['+imageLabel+' — selected area]('+c.area+')','');
  });
  return lines.join("\n").split("\n");
}
