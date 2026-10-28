import { describe, expect, test } from 'bun:test';
import { historyNoteHtml } from './history-ui.ts';
import { historySnapshot, historyText } from './history-model.ts';
import { historyRevision } from './history-store.ts';

const note=(fields: any={})=>historySnapshot('',[{id:'x',file:'a.ts',body:'Question',...fields}]).notes[0]!;
describe('reading archived conversations',()=>{
  test('renders both voices as Markdown without exposing editing or send controls',()=>{
    const html=historyNoteHtml(note({body:'**Question**',messages:[{role:'agent',body:'`Answer`'},{role:'reviewer',body:'Follow-up'}]}));
    expect(html).toContain('<strong>Question</strong>');
    expect(html).toContain('<code>Answer</code>');
    expect(html).toContain('Follow-up');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<textarea');
  });
  test('escapes HTML in questions, replies, captures, status and timestamps',()=>{
    const html=historyNoteHtml(note({body:'<script>alert(1)</script>',code:'<img onerror=alert(1)>',status:'<svg onload=x>',
      detail:'<iframe>',messages:[{role:'agent',body:'<img onerror=x>',at:'<script>'}]}));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<iframe>');
    expect(html).toContain('&lt;script&gt;');
  });
  test('historical note references retain their old wording without navigating to current notes',()=>{
    const html=historyNoteHtml(note({body:'See [Old heading](lcr:abc123).'}));
    expect(html).toContain('Old heading');
    expect(html).not.toContain('data-nref');
    expect(html).not.toContain('nref');
  });
  test('copying a deletion includes the removed question and answer',()=>{
    const before={file:'review.md',notes:[note({messages:[{role:'agent',body:'Archived answer'}]})]};
    const entry=historyRevision({scope:'x',source:'page',snapshot:{file:'review.md',notes:[]}},before)!;
    const copied=historyText(entry,'changes');
    expect(copied).toContain('Before'); expect(copied).toContain('Question');
    expect(copied).toContain('Archived answer'); expect(copied).toContain('After\n\nNot present');
  });
});
