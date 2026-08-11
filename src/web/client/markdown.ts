import { codeHtml, langOf } from './highlight.ts';
import { esc } from './state.ts';

/* ---------- markdown ---------- */
/**
 * A note and the answer to it are written as Markdown — both sides of the conversation are prose with
 * code in it — so both are read as Markdown rather than as the characters they were typed as. This is
 * the subset a code review actually speaks: headings, fenced and inline code, lists, quotes, tables,
 * emphasis, links, rules.
 *
 * Nothing here trusts its input. Every run of text goes through `esc` and the only tags in the output
 * are the ones this file writes, so a note containing markup shows the markup instead of running it.
 * A fence is coloured by the diff's own tokeniser, which is why the block carries class `c`; a fence
 * with no language named is read as the file the note is on.
 */

const HEAD=/^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE=/^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const RULE=/^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const ITEM=/^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE=/^ {0,3}>[ \t]?(.*)$/;
/** What an agent ticks off as it works through a note, kept as the box it wrote rather than as text. */
const TASK=/^\[([ xX])\][ \t]+/;
const DELIM=/^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function mdHtml(src: string,path?: string): string{
  return blocks(String(src==null?'':src).replace(/\r\n?/g,'\n').split('\n'),langOf(path||''));
}

/** Whether a line opens a block of its own, which is what ends the paragraph or item above it. */
function starts(lines: string[],i: number){
  const line=lines[i], next=lines[i+1]||'';
  return HEAD.test(line)||FENCE.test(line)||RULE.test(line)||ITEM.test(line)||QUOTE.test(line)||
    (line.includes('|')&&next.includes('-')&&DELIM.test(next));
}
/** A closing fence is the same character, at least as long, and alone on its line. */
function closes(line: string,fence: string){
  const m=/^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m&&m[1][0]===fence[0]&&m[1].length>=fence.length;
}
const indentOf=(line: string)=>/^[ \t]*/.exec(line)![0].length;

function blocks(lines: string[],lang: string): string{
  let out='',i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){ i++; continue; }
    const fence=FENCE.exec(line);
    if(fence){
      const body: string[]=[];
      i++;
      while(i<lines.length&&!closes(lines[i],fence[1])) body.push(lines[i++]);
      i++; // the closing fence, or the end of a fence that was never closed
      out+='<pre class="c mdb"><code>'+
        body.map(l=>codeHtml(l,fence[2]?langOf('.'+fence[2]):lang)).join('\n')+'</code></pre>';
      continue;
    }
    if(RULE.test(line)){ out+='<hr>'; i++; continue; }
    const head=HEAD.exec(line);
    if(head){
      const n=head[1].length;
      out+='<h'+n+'>'+inline(head[2])+'</h'+n+'>'; i++;
      continue;
    }
    if(QUOTE.test(line)){
      const inner: string[]=[];
      while(i<lines.length){
        const q=QUOTE.exec(lines[i]);
        if(q){ inner.push(q[1]); i++; continue; }
        // prose running on under a quote belongs to it; a blank line or a new block ends it
        if(!lines[i].trim()||starts(lines,i)) break;
        inner.push(lines[i++]);
      }
      out+='<blockquote>'+blocks(inner,lang)+'</blockquote>';
      continue;
    }
    if(ITEM.test(line)){
      const list=listAt(lines,i,lang);
      out+=list.html; i=list.at;
      continue;
    }
    if(line.includes('|')&&(lines[i+1]||'').includes('-')&&DELIM.test(lines[i+1]||'')){
      const table=tableAt(lines,i);
      out+=table.html; i=table.at;
      continue;
    }
    const para=[line]; i++;
    while(i<lines.length&&lines[i].trim()&&!starts(lines,i)) para.push(lines[i++]);
    out+='<p>'+inline(para.join('\n'))+'</p>';
  }
  return out;
}

/**
 * One list, from its first marker to the first line that is no longer part of it. An item's own lines
 * are dedented and rendered as blocks in their own right, so a nested list is read by the same code
 * relative to its own indent. A blank line anywhere inside makes the list loose, which is the only
 * difference between an item that keeps its paragraph and one that does not.
 */
function listAt(lines: string[],from: number,lang: string){
  const first=ITEM.exec(lines[from])!;
  const ind=first[1].length, ordered=/\d/.test(first[2]);
  const items: {lines: string[],box: string}[]=[];
  let cur: {lines: string[],box: string}|null=null, loose=false, blank=false, i=from;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){ blank=true; i++; continue; }
    const at=indentOf(line), item=ITEM.exec(line);
    if(item&&item[1].length<=ind){
      // a dedent, or a different kind of marker, is another list rather than this one
      if(item[1].length<ind||/\d/.test(item[2])!==ordered) break;
      if(blank&&cur) loose=true;
      const task=TASK.exec(item[3]);
      cur={lines:[task?item[3].slice(task[0].length):item[3]],box:task?task[1].toLowerCase():''};
      items.push(cur); blank=false; i++;
      continue;
    }
    if(!cur) break;
    if(at<=ind&&(blank||starts(lines,i))) break;
    if(blank){ cur.lines.push(''); loose=true; blank=false; }
    cur.lines.push(at>ind?line.slice(Math.min(at,ind+2)):line);
    i++;
  }
  const tag=ordered?'ol':'ul';
  const start=ordered?parseInt(first[2],10):1;
  const html='<'+tag+(ordered&&start!==1?' start="'+start+'"':'')+'>'+
    items.map(it=>'<li'+(it.box?' class="task"':'')+'>'+
      (it.box?'<input type="checkbox" disabled'+(it.box==='x'?' checked':'')+'>':'')+
      liHtml(blocks(it.lines,lang),loose)+'</li>').join('')+'</'+tag+'>';
  return {html,at:i};
}
/** A tight item drops the wrapper around its first paragraph, so a plain list reads as a plain list. */
function liHtml(html: string,loose: boolean){
  if(loose||!html.startsWith('<p>')) return html;
  const shut=html.indexOf('</p>'), next=html.indexOf('<p>',3);
  if(shut<0||(next>=0&&next<shut)) return html;
  return html.slice(3,shut)+html.slice(shut+4);
}

/** The cells of one row, split on the pipes that are not escaped. */
function cells(line: string){
  const out: string[]=[];
  const row=line.trim().replace(/^\|/,'').replace(/\|$/,'');
  let cur='';
  for(let i=0;i<row.length;i++){
    if(row[i]==='\\'&&row[i+1]==='|'){ cur+='|'; i++; continue; }
    if(row[i]==='|'){ out.push(cur); cur=''; continue; }
    cur+=row[i];
  }
  out.push(cur);
  return out.map(v=>v.trim());
}
/** The header decides how many columns the table has; a short row is padded and a long one is cut. */
function tableAt(lines: string[],from: number){
  const head=cells(lines[from]);
  const align=cells(lines[from+1]).map(c=>/^:-+:$/.test(c)?'center':/-+:$/.test(c)?'right':/^:-+/.test(c)?'left':'');
  const rows: string[][]=[];
  let i=from+2;
  while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')&&!starts(lines,i)) rows.push(cells(lines[i++]));
  const cell=(tag: string,v: string,k: number)=>'<'+tag+(align[k]?' style="text-align:'+align[k]+'"':'')+'>'+
    inline(v||'')+'</'+tag+'>';
  const html='<div class="mdt"><table><thead><tr>'+head.map((v,k)=>cell('th',v,k)).join('')+'</tr></thead>'+
    (rows.length?'<tbody>'+rows.map(r=>'<tr>'+head.map((_,k)=>cell('td',r[k],k)).join('')+'</tr>').join('')+'</tbody>':'')+
    '</table></div>';
  return {html,at:i};
}

/* ---------- inline ---------- */
/** Everything that can start something inside a line. Text between two of these is plain text. */
const NEXT=/\\[^\n]|`+|\*{1,3}|_{1,3}|~~|!?\[|<[^\s<>]+>|https?:\/\/[^\s<>]+/g;
const EMPH: [RegExp,string,string][]=[
  [/^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/,'<strong><em>','</em></strong>'],
  [/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/,'<strong>','</strong>'],
  [/^(\*|_)(?=\S)([\s\S]*?\S)\1(?!\1)/,'<em>','</em>'],
  [/^(~~)(?=\S)([\s\S]*?\S)\1/,'<del>','</del>'],
];
const LINK=/^(!?)\[((?:[^\[\]\\]|\\.|\[[^\]]*\])*)\]\([ \t]*(<[^>\s]*>|[^\s)]*)(?:[ \t]+"[^"]*")?[ \t]*\)/;
const MAIL=/^[^\s@<>]+@[^\s@<>.]+\.[^\s@<>]+$/;
/**
 * A link that goes somewhere a click can safely go. Everything else — `javascript:`, `data:`, and any
 * other scheme this local page has no business following — is left as the text it was written as.
 */
function safeUrl(raw: string){
  const url=raw.replace(/^<|>$/g,'').trim();
  if(!url) return '';
  if(/^(https?:\/\/|mailto:|#|\/|\.{0,2}\/)/i.test(url)) return url;
  if(MAIL.test(url)) return 'mailto:'+url;
  return /^[a-z][a-z\d+.-]*:/i.test(url)?'':url; // a bare word is a relative path; a scheme is not
}
const href=(url: string,body: string)=>
  '<a href="'+esc(url)+'" target="_blank" rel="noreferrer noopener">'+body+'</a>';
/** Plain text, with the line breaks it was typed with kept: a note is read the way it was written. */
const text=(v: string)=>esc(v).replace(/\n/g,'<br>');

export function inline(src: string): string{
  let out='',at=0,m: RegExpExecArray|null;
  NEXT.lastIndex=0;
  while((m=NEXT.exec(src))){
    const tok=m[0], from=m.index;
    let html='', to=0;
    if(tok[0]==='\\'){
      // a backslash only escapes punctuation; before anything else it is a backslash
      html=esc(/[\\`*_{}\[\]()#+\-.!>~|"']/.test(tok[1])?tok[1]:tok); to=from+tok.length;
    }else if(tok[0]==='`'){
      const run=/`+/g; run.lastIndex=from+tok.length;
      let r: RegExpExecArray|null, shut=-1;
      while((r=run.exec(src))) if(r[0].length===tok.length){ shut=r.index; break; }
      if(shut>=0){
        // a code span holds one line of code, and one space either side is room for backticks in it
        let code=src.slice(from+tok.length,shut).replace(/\n/g,' ');
        if(code.length>2&&code.startsWith(' ')&&code.endsWith(' ')&&code.trim()) code=code.slice(1,-1);
        html='<code>'+esc(code)+'</code>'; to=shut+tok.length;
      }
    }else if(tok==='['||tok==='!['){
      const link=LINK.exec(src.slice(from));
      const url=link?safeUrl(link[3]):'';
      if(link&&url){
        // an image is shown as the link it is: this page never reaches out to the network for a note
        const label=inline(link[2]||url);
        html=link[1]?href(url,label||esc(url)):href(url,label); to=from+link[0].length;
      }
    }else if(tok[0]==='<'){
      const url=safeUrl(tok.slice(1,-1));
      if(url&&/^(https?:|mailto:)/i.test(url)){ html=href(url,esc(tok.slice(1,-1))); to=from+tok.length; }
    }else if(tok[0]==='h'){
      // a bare address is a link, minus the punctuation that ends the sentence around it
      const url=tok.replace(/[.,;:!?)\]}'"]+$/,'');
      html=href(url,esc(url)); to=from+url.length;
    }else if(!(tok[0]==='_'&&/[\w]/.test(src[from-1]||''))){ // snake_case is a name, not emphasis
      for(const [rx,open,shut] of EMPH){
        const em=rx.exec(src.slice(from));
        if(!em) continue;
        html=open+inline(em[2])+shut; to=from+em[0].length;
        break;
      }
    }
    if(!to){ // nothing was made of it, so it is the text it was typed as
      out+=text(src.slice(at,from+tok.length)); at=NEXT.lastIndex=from+tok.length;
      continue;
    }
    out+=text(src.slice(at,from))+html;
    at=NEXT.lastIndex=to;
  }
  return out+text(src.slice(at));
}
