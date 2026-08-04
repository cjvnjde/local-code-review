import { esc } from './state.ts';

/* ---------- syntax colouring (line-scoped, delta-ish) ---------- */
const KW_TS='const let var function return if else for while do switch case break continue import export from as default '+
  'class extends implements interface type enum new await async try catch finally throw typeof instanceof in of delete void '+
  'yield public private protected readonly static get set this super null undefined true false satisfies keyof infer declare '+
  'namespace abstract override require module';
const KW_PY='def class return if elif else for while import from as pass break continue try except finally raise with lambda '+
  'global nonlocal yield async await None True False not and or in is del assert';
const KW_SH='if then else elif fi for while do done case esac function return local export unset echo cd exit source set trap shift read';
// \x60 is a backtick: this source lives inside a raw template literal, so it cannot contain one.
const STR='("(?:[^"\\\\]|\\\\.)*"?|\'(?:[^\'\\\\]|\\\\.)*\'?|\x60(?:[^\x60\\\\]|\\\\.)*\x60?)';
const RULES={
  ts:['(\\/\\/.*|\\/\\*.*?\\*\\/|\\/\\*.*)','m',STR,'s','(\\b(?:'+KW_TS.split(' ').join('|')+')\\b)','k',
      '(\\b0[xXbBoO][\\da-fA-F_]+|\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[-+]?\\d+)?)','n',
      '([A-Za-z_$][\\w$]*(?=\\s*[(<]))','f','(\\b[A-Z][\\w$]*)','t','([{}\\[\\]();,.:?!=+\\-*/%<>&|^~]+)','p'],
  json:['("(?:[^"\\\\]|\\\\.)*"(?=\\s*:))','y',STR,'s','(\\b(?:true|false|null)\\b)','k','(-?\\b\\d[\\d.eE+-]*)','n','([{}\\[\\],:]+)','p'],
  css:['(\\/\\*.*?\\*\\/|\\/\\*.*)','m',STR,'s','(@[\\w-]+)','k','([-\\w]+(?=\\s*:))','y',
       '(#[\\da-fA-F]{3,8}\\b|\\b\\d[\\d.]*(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\\b)','n','([{}();:,>+~]+)','p'],
  md:['(^\\s*#{1,6}\\s.*)','h','(\x60\x60\x60.*|~~~.*)','k','(\x60[^\x60]*\x60)','s',
      '(\\*\\*[^*]+\\*\\*|__[^_]+__)','b','(\\[[^\\]]*\\]\\([^)]*\\))','l','(^\\s*[-*+]\\s|^\\s*\\d+\\.\\s)','p'],
  yaml:['(#.*)','m','(^\\s*-?\\s*[\\w.$-]+(?=\\s*:))','y',STR,'s','(\\b(?:true|false|null|yes|no|on|off)\\b)','k','(\\b\\d[\\d.]*\\b)','n','([-:|>&*]+)','p'],
  sh:['(#.*)','m',STR,'s','(\\b(?:'+KW_SH.split(' ').join('|')+')\\b)','k','(\\$\\{?[\\w@#?*-]+\\}?)','v','(\\s--?[\\w-]+)','y','(\\b\\d+\\b)','n','([|&;()<>{}=]+)','p'],
  py:['(#.*)','m',STR,'s','(\\b(?:'+KW_PY.split(' ').join('|')+')\\b)','k','(@[\\w.]+)','y',
      '(\\b\\d[\\d._eE+-]*)','n','([A-Za-z_][\\w]*(?=\\s*\\())','f','(\\b[A-Z][\\w]*)','t','([{}\\[\\]();,.:=+\\-*/%<>&|^~]+)','p'],
  html:['(<!--.*?-->|<!--.*)','m','(<\\/?[\\w:-]+)','k',STR,'s','([\\w:-]+(?==))','y','([<>\\/=]+)','p'],
  txt:[STR,'s','(#.*)','m','(\\b\\d[\\d.]*\\b)','n'],
};
const RX={};
function rxFor(lang){
  if(!RX[lang]){
    const r=RULES[lang]||RULES.txt, pats=[], cls=[];
    for(let i=0;i<r.length;i+=2){ pats.push(r[i]); cls.push(r[i+1]); }
    RX[lang]={re:new RegExp(pats.join('|'),'g'),cls};
  }
  return RX[lang];
}
export function langOf(p: string){
  const e=(p.split('/').pop().split('.').pop()||'').toLowerCase();
  if('ts tsx js jsx mjs cjs mts cts'.split(' ').includes(e)) return 'ts';
  if(e==='json'||e==='jsonc') return 'json';
  if('css scss less'.split(' ').includes(e)) return 'css';
  if('md mdx markdown'.split(' ').includes(e)) return 'md';
  if(e==='yml'||e==='yaml') return 'yaml';
  if('sh bash zsh fish'.split(' ').includes(e)) return 'sh';
  if(e==='py') return 'py';
  if('html htm vue svelte xml'.split(' ').includes(e)) return 'html';
  return 'txt';
}
function tokens(text,lang){
  // A continuation line of a block comment has no opener on this line, so match it by shape.
  if((lang==='ts'||lang==='css')&&/^\s*\*/.test(text)) return [{s:0,e:text.length,c:'m'}];
  const {re,cls}=rxFor(lang), out=[];
  let last=0,m;
  re.lastIndex=0;
  while((m=re.exec(text))){
    if(!m[0]){ re.lastIndex++; continue; }
    if(m.index>last) out.push({s:last,e:m.index,c:''});
    let g=1;
    while(g<m.length&&m[g]===undefined) g++;
    out.push({s:m.index,e:m.index+m[0].length,c:cls[g-1]||''});
    last=re.lastIndex;
  }
  if(last<text.length) out.push({s:last,e:text.length,c:''});
  return out;
}
/**
 * `wr` is the word-diff range; `marks` are extra character ranges such as a note anchor.
 * Segments are cut at every range edge so a segment either is or is not inside each range.
 */
export function codeHtml(text: string,lang: string,wr?: [number, number]|null,marks?: any[]|null){
  if(!text) return '';
  const spans: any[]=[];
  if(wr) spans.push({s:wr[0],e:wr[1],c:'w'});
  if(marks) for(const m of marks) if(m.e>m.s) spans.push(m);
  let out='';
  for(const t of tokens(text,lang)){
    let s=t.s;
    while(s<t.e){
      let e=t.e;
      for(const p of spans){
        if(p.s>s&&p.s<e) e=p.s;
        if(p.e>s&&p.e<e) e=p.e;
      }
      const cls=[t.c||''].concat(spans.filter(p=>s>=p.s&&s<p.e).map(p=>p.c)).filter(Boolean).join(' ');
      const seg=esc(text.slice(s,e));
      out+=cls?'<span class="'+cls+'">'+seg+'</span>':seg;
      s=e;
    }
  }
  return out;
}
