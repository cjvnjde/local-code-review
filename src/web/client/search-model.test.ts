import { describe, expect, test } from 'bun:test';
import { matchRanges, searchDocuments, searchExcerpt, searchHtml, searchReview, searchSegments } from './search-model.ts';

const files=[{path:'src/cache.ts',from:'src/old-cache.ts',rows:[
  {t:'hunk',text:'@@ heading not searchable @@'},
  {t:'ctx',n:10,o:10,text:'// nearby explanation'},
  {t:'del',o:11,text:'return staleValue;'},
  {t:'add',n:11,text:'return freshValue;'},
  {t:'hunk',text:'@@ distant hunk @@'},
  {t:'ctx',n:500,o:500,text:'distantContext'},
]}];
const note={id:'n',file:'src/cache.ts',body:'Why keep the stale value?',code:'-return staleValue;'};
const docs=()=>searchDocuments(files,[note,{id:'g',file:'',body:'Overall concern'}],
  new Map([['n',[{role:'agent',body:'Cache invalidation fixed.'},{role:'reviewer',body:'Thanks for the explanation.'}]]]),
  new Map([['n',{status:'applied',detail:'Removed stale data'}]]));

describe('review search',()=>{
  test('finds code on both sides and surrounding context without hunk headers',()=>{
    expect(searchReview(docs(),'freshValue').map(r=>r.kind)).toEqual(['code']);
    expect(searchReview(docs(),'staleValue').map(r=>r.kind)).toEqual(['code','note']);
    expect(searchReview(docs(),'nearby')[0].row).toBe('n10');
    expect(searchReview(docs(),'heading not searchable')).toEqual([]);
    expect(searchReview(docs(),'freshValue')[0].context).not.toContain('distantContext');
    expect(searchReview(docs(),'not in the diff')).toEqual([]);
  });
  test('finds filenames, rename sources, global notes, status and both speakers',()=>{
    expect(searchReview(docs(),'old-cache')[0].kind).toBe('file');
    expect(searchReview(docs(),'cache.ts').map(r=>r.kind)).toEqual(['file']);
    expect(searchReview(docs(),'OVERALL')[0].noteId).toBe('g');
    expect(searchReview(docs(),'applied')[0].label).toBe('Status');
    expect(searchReview(docs(),'invalidation')[0]).toMatchObject({kind:'reply',noteId:'n',message:0,label:'Agent answer'});
    expect(searchReview(docs(),'thanks')[0]).toMatchObject({message:1,label:'Reviewer reply'});
  });
  test('combines filename and content terms; whitespace is not a query',()=>{
    expect(searchReview(docs(),'cache.ts FRESHVALUE').map(r=>r.kind)).toEqual(['code']);
    expect(searchReview(docs(),'other.ts freshValue')).toEqual([]);
    expect(searchReview(docs(),'  ')).toEqual([]);
  });
  test('rebuilding reflects replies, deletion and revealed context without changing the source',()=>{
    const messages=new Map([['n',[{role:'agent',body:'First answer'}]]]);
    const original=JSON.stringify(files);
    expect(searchReview(searchDocuments(files,[note],messages,new Map()),'First answer')).toHaveLength(1);
    messages.set('n',[{role:'agent',body:'Replacement answer'}]);
    expect(searchReview(searchDocuments(files,[note],messages,new Map()),'First answer')).toHaveLength(0);
    expect(searchReview(searchDocuments(files,[],messages,new Map()),'Replacement')).toHaveLength(0);
    expect(JSON.stringify(files)).toBe(original);
  });
  test('uses literal matching and escapes markup around every highlight',()=>{
    expect(matchRanges('a.b [x] a+b','a.b')).toEqual([[0,3]]);
    expect(searchHtml('<script>[x] & a+b</script>','[x] a+b')).toBe('&lt;script&gt;<mark>[x]</mark> &amp; <mark>a+b</mark>&lt;/script&gt;');
    expect(matchRanges('a.b ab','.*')).toEqual([]);
    expect(searchHtml('cache cached','cache cached')).toBe('<mark>cache</mark> <mark>cached</mark>');
  });
  test('shows a late match in a long answer',()=>{
    const excerpt=searchExcerpt('x'.repeat(1000)+'target'+'y'.repeat(1000),'target',90);
    expect(excerpt).toContain('target'); expect(excerpt.length).toBeLessThanOrEqual(92);
  });
  test('maps a match across syntax spans without rewriting or losing offsets',()=>{
    expect(searchSegments(['return ','fresh','Value',';'],'freshValue')).toEqual([
      {start:{part:1,offset:0},end:{part:2,offset:5}},
    ]);
    expect(searchSegments(['','abc','','def',''],'abcdef')).toEqual([
      {start:{part:1,offset:0},end:{part:3,offset:3}},
    ]);
    expect(searchSegments([],'abc')).toEqual([]);
    expect(searchSegments(['abc'],'')).toEqual([]);
  });
});
