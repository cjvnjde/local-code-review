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
}
export interface WebReview { before: WebCapture; after: WebCapture[] }
const finite=(v: unknown)=>typeof v==='number'&&Number.isFinite(v);
const ref=(v: unknown)=>typeof v==='string'&&/^images\/[a-z0-9][a-z0-9._-]*\.png$/i.test(v);
export function localWebUrl(raw: string): string {
  let url: URL;
  try { url=new URL(raw); } catch { throw new Error('--web requires a localhost HTTP(S) URL.'); }
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)
    throw new Error('--web requires a localhost HTTP(S) URL without credentials.');
  return url.href;
}
export function webCapture(value: any): WebCapture|null {
  if(!value||typeof value.url!=='string'||typeof value.title!=='string'||typeof value.at!=='string'||
    !Number.isFinite(Date.parse(value.at))||!['element','block','area','point'].includes(value.mode)) return null;
  try { localWebUrl(value.url); } catch { return null; }
  const r=value.rect,v=value.viewport,s=value.scroll;
  if(!r||!v||!s||![r.x,r.y,r.width,r.height,v.width,v.height,v.dpr,s.x,s.y].every(finite)||
    r.x<0||r.y<0||r.width<=0||r.height<=0||v.width<=0||v.height<=0||v.dpr<=0||
    r.x+r.width>v.width+1||r.y+r.height>v.height+1||!ref(value.page)||!ref(value.area)) return null;
  const strings=(record: any)=>record&&typeof record==='object'&&!Array.isArray(record)&&
    Object.entries(record).length<=50&&Object.values(record).every(x=>typeof x==='string'&&x.length<=4000);
  const element=value.element;
  if(element&&(typeof element.tag!=='string'||typeof element.text!=='string'||!strings(element.attributes)||!strings(element.styles))) return null;
  if(value.selector!=null&&typeof value.selector!=='string') return null;
  if(!Array.isArray(value.components)||value.components.length>30||value.components.some((c: any)=>
    !c||!['React','Vue'].includes(c.framework)||typeof c.name!=='string'||
    (c.file!=null&&typeof c.file!=='string')||(c.line!=null&&(!Number.isSafeInteger(c.line)||c.line<0)))) return null;
  // Detach and whitelist, including nested records, before asynchronous storage or rendering.
  return JSON.parse(JSON.stringify({url:value.url,title:value.title,at:value.at,mode:value.mode,
    rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:v.width,height:v.height,dpr:v.dpr},
    scroll:{x:s.x,y:s.y},page:value.page,area:value.area,
    ...(value.selector?{selector:value.selector}:{}),...(element?{element:{tag:element.tag,text:element.text,attributes:element.attributes,styles:element.styles}}:{}),
    components:value.components.map((c: any)=>({framework:c.framework,name:c.name,...(c.file?{file:c.file}:{}),...(c.line!=null?{line:c.line}:{})}))}));
}
export function webReview(value: any): WebReview|null {
  const before=webCapture(value?.before);
  if(!before||!Array.isArray(value.after)||value.after.length>100) return null;
  const after=value.after.map(webCapture);
  return after.every(Boolean)?{before,after}:null;
}
/** Human-readable evidence and a sealed machine-readable copy both travel in ordinary Markdown. */
export function webReviewLines(web: WebReview): string[] {
  web = webReview(web)!;
  const json=JSON.stringify(web).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const lines=['<!-- lcr:web '+json+' -->','','UI capture: '+web.before.mode+' selection. Metadata and screenshots record the page at capture time.',''];
  [web.before,...web.after].forEach((c,i)=>{
    const data=JSON.stringify({...c,page:undefined,area:undefined},null,2);
    const fence='`'.repeat(Math.max(3,...(data.match(/`+/g)||[]).map(s=>s.length+1)));
    lines.push(i?'After capture '+i+':':'Before capture:', '',fence+'json',data,fence,'',
      '!['+(i?'After':'Before')+' — page]('+c.page+')','',
      '!['+(i?'After':'Before')+' — selected area]('+c.area+')','');
  });
  return lines.join("\n").split("\n");
}
