import { expect, test } from 'bun:test';
import { readingAt, readingPlace, readingRow, resumeOffset, scrollVelocity, settleDelay } from './reading-model.ts';

const file=(lines: string[],hash='original')=>({path:'src/app.ts',hash,
  rows:lines.map((text,i)=>({t:'ctx',n:i+1,o:i+1,text}))});

test('a reading place follows unique captured code after lines move',()=>{
  const original=file(['before','continue here','after']);
  const place=readingPlace(original,1);
  expect(readingRow(original,place)).toBe(1);
  expect(readingRow(file(['inserted','before','continue here','after'],'changed'),place)).toBe(2);
  expect(readingRow(file(['unrelated','replacement','after'],'changed'),place)).toBe(-1);
});

test('repeated code needs an unambiguous neighbour; never guess by line proximity',()=>{
  const place=readingPlace(file(['before','}','after']),1);
  expect(readingRow(file(['other','}','else','before','}','after'],'new'),place)).toBe(4);
  expect(readingRow(file(['before','}','after','before','}','after'],'new'),place)).toBe(-1);
});

test('file-only positions have no line and fast scrolling needs a longer pause',()=>{
  const empty=file([]);
  expect(readingRow(empty,readingPlace(empty,-1))).toBe(-1);
  expect(settleDelay(2500,900)).toBeGreaterThan(settleDelay(300,900));
  expect(settleDelay(2500,0)).toBeGreaterThan(settleDelay(300,0));
  expect(settleDelay(scrollVelocity(1500,10000),900)).toBeGreaterThan(
    settleDelay(scrollVelocity(60,10000),900));
});

test('Resume retains the row offset, falls back below the header for older markers, and fits a resized pane',()=>{
  const place=readingPlace(file(['start','read here']),1,76);
  expect(resumeOffset(place.offset,40,900)).toBe(76);
  expect(resumeOffset(undefined,40,900)).toBe(40);
  expect(resumeOffset(10,40,900)).toBe(40);
  expect(resumeOffset(700,40,200)).toBe(160);
});

const card=(path: string,top: number,bottom: number,header: number,rows: number[],fold=false)=>({
  dataset:{path},getBoundingClientRect:()=>({top,bottom}),classList:{contains:()=>fold},
  querySelector:()=>({getBoundingClientRect:()=>({bottom:header})}),
  querySelectorAll:()=>rows.map((top,i)=>({dataset:{i:String(i)},getBoundingClientRect:()=>({top,bottom:top+24})})),
});
const lookup=(path: string)=>({fi:path==='first'?0:1,file:{path,rows:[]}});

test('reading position uses visible code below the sticky header, even across file boundaries',()=>{
  const at=readingAt({top:100,bottom:600},[
    card('first',-500,130,130,[70,94]),card('second',140,900,180,[181,205]),
  ],lookup)!;
  expect(at.file.path).toBe('second'); expect(at.index).toBe(0); expect(at.offset).toBe(81);
});

test('folded rows are skipped and a lazy placeholder cannot claim a visible line',()=>{
  const at=readingAt({top:100,bottom:600},[
    card('first',80,200,140,[145],true),card('second',210,900,250,[]),
  ],lookup)!;
  expect(at.index).toBe(-1);
  expect(readingAt({top:100,bottom:600},[card('first',700,900,740,[745])],lookup)).toBeNull();
});
