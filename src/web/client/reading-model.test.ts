import { expect, test } from 'bun:test';
import { readingPlace, readingRow, scrollVelocity, settleDelay } from './reading-model.ts';

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
