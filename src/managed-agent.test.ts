import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acpAnswer, createManagedAgent, type ManagedAgent } from './managed-agent.ts';
import { createSession } from './session.ts';
import { reviewerRevision } from './agent-queue.ts';
const fixture = path.join(import.meta.dir, 'fixtures/acp-agent.ts');
const roots: string[] = []; const agents: ManagedAgent[] = [];
afterEach(async () => { for (const agent of agents.splice(0)) await agent.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function until(check: () => boolean, label = 'condition') { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await Bun.sleep(10); } }
const comment = (name: string, body = 'Question ' + name) => ({ id: `a.ts|n1|n1|#${name}`, file: 'a.ts', start: 1, end: 1, body, label: '1', code: '+line' });
async function setup(mode = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'lcr-managed-')); roots.push(root);
  const session = createSession(root, '.review', 'HEAD');
  const config = { name: 'Any ACP peer', command: process.execPath, args: [fixture], env: { LCR_ACP_FIXTURE: root, LCR_ACP_MODE: mode } };
  const options = { repoRoot: root, session, outDir: '.review', directory: path.join(root, 'git-state'), config, notify() {} };
  const make = () => { const agent = createManagedAgent(options); agents.push(agent); return agent; };
  const agent = make(); await agent.check!();
  const save = async (name: string, body?: string) => { const saved = await session.save({ comments: [comment(name, body)] }); return saved.changed[0]!; };
  const send = async (name: string, body?: string) => { const note = await save(name, body); await agent.publish(session.file, [note]); return note; };
  const release = (n: number) => writeFileSync(path.join(root, 'release-' + n), '');
  const started = (n: number) => existsSync(path.join(root, 'started-' + n));
  const tasks = () => agent.snapshot().tasks;
  const rpc = () => readFileSync(path.join(root, 'rpc.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { root, session, agent, make, send, save, release, started, tasks, rpc };
}
test('ACP runs sequentially, coalesces queued edits, and reuses one review session', async () => {
  const f = await setup(); const a = await f.send('a'); await until(() => f.started(1));
  await f.send('b'); await f.send('b', 'Edited pending'); await f.send('a', 'Follow-up while active');
  expect(f.started(2)).toBe(false); expect(f.tasks().map((task: any) => task.state)).toEqual(['running', 'queued', 'queued']);
  f.release(1); await until(() => f.started(2));
  const first = await f.session.readNote(f.session.file, a.id);
  expect(first!.body).toBe('Follow-up while active'); expect(first!.status).toBe('pending');
  expect(first!.messages[0]!.body).toContain('Later reviewer edits');
  f.release(2); await until(() => f.started(3)); f.release(3); await until(() => f.tasks().every((task: any) => task.state === 'completed'));
  expect(f.rpc().filter((message: any) => message.method === 'session/new')).toHaveLength(1);
  const prompts = f.rpc().filter((message: any) => message.method === 'session/prompt');
  expect(prompts[1].params.prompt[0].text).toContain('Edited pending');
  expect(prompts[0].params.prompt[0].text).not.toContain('Follow-up while active');
  expect(prompts[2].params.prompt[0].text).toContain('Fixture answer 1');
});
test('deleted pending notes cancel; a late active result cannot recreate a deleted note', async () => {
  const f = await setup(); const a = await f.send('a'); await until(() => f.started(1)); const b = await f.send('b');
  const review = f.session.file; await f.session.remove([a.id, b.id]); await f.agent.withdraw(review, [a.id, b.id]);
  await until(() => f.tasks().every((task: any) => task.state === 'cancelled'));
  expect(f.started(2)).toBe(false); expect((await f.session.read()).notes).toEqual([]);
});
test('review switches keep prompts and answers in the original exact review', async () => {
  const f = await setup(); const a = await f.send('a'); await until(() => f.started(1)); const old = f.session.file;
  await f.session.run(async () => f.session.startFresh()); const b = await f.send('b'); const next = f.session.file;
  f.release(1); await until(() => f.started(2));
  expect((await f.session.readNote(old, a.id))!.messages[0]!.body).toBe('Fixture answer 1');
  expect((await f.session.readNote(next, b.id))!.messages).toEqual([]);
  f.release(2); await until(() => f.tasks().every((task: any) => task.state === 'completed'));
  expect(f.rpc().filter((message: any) => message.method === 'session/new')).toHaveLength(2);
});
test('permission requests wait for explicit choices, reject invalid options and cancel outstanding approvals', async () => {
  const f = await setup('permission'); await f.send('a'); await until(() => f.agent.snapshot().permissions.length === 1);
  expect(f.tasks()[0].state).toBe('approval'); const approval = f.agent.snapshot().permissions[0];
  await expect(f.agent.control('permission', approval.id, 'invented')).rejects.toThrow();
  expect(existsSync(path.join(f.root, 'permission-1'))).toBe(false);
  await f.agent.control('cancel', f.tasks()[0].id);
  await until(() => f.tasks()[0].state === 'cancelled');
  expect(JSON.parse(readFileSync(path.join(f.root, 'permission-1'), 'utf8'))).toEqual({ outcome: { outcome: 'cancelled' } });
});
test('rejected permission leads to needs-input and pauses subsequent work', async () => {
  const f = await setup('permission'); await f.send('a'); await f.send('b');
  await until(() => f.agent.snapshot().permissions.length === 1);
  await f.agent.control('permission', f.agent.snapshot().permissions[0].id, 'no'); f.release(1);
  await until(() => f.tasks()[0].state === 'needs-input');
  expect(f.started(2)).toBe(false); expect(f.agent.snapshot().paused).toBe(true);
});
test('transport loss during a prompt is uncertain and restart never automatically repeats it', async () => {
  const f = await setup('crash'); await f.send('a'); await until(() => f.tasks()[0].state === 'uncertain');
  await f.save('b').then(note => f.agent.publish(f.session.file, [note]));
  await f.agent.close(); const reopened = f.make(); await reopened.check!();
  expect(reopened.snapshot().tasks.map((task: any) => task.state)).toEqual(['uncertain', 'queued']);
  await expect(reopened.control('resume')).rejects.toThrow('acknowledge');
  expect(f.rpc().filter((message: any) => message.method === 'session/prompt')).toHaveLength(1);
  await reopened.control('acknowledge', reopened.snapshot().tasks[0].id);
  expect(reopened.snapshot().tasks[0].state).toBe('cancelled');
});
test('restart restores queued work and loads the negotiated saved session without replaying history as a reply', async () => {
  const f = await setup(); const a = await f.send('a'); await until(() => f.started(1)); f.release(1); await until(() => f.tasks()[0].state === 'completed');
  await f.agent.control('pause'); await f.send('b'); await f.agent.close();
  const reopened = f.make(); await reopened.check!(); await reopened.control('resume');
  await until(() => f.rpc().filter((message: any) => message.method === 'session/prompt').length === 2);
  await until(() => reopened.snapshot().tasks[1].state === 'completed');
  expect(f.rpc().filter((message: any) => message.method === 'session/load')).toHaveLength(1);
  const doc = await f.session.read(); expect(JSON.stringify(doc)).not.toContain('HISTORY REPLAY');
  expect(doc.notes.find(note => note.id === a.id)!.messages).toHaveLength(1);
});
test('a session that cannot be loaded requires explicit new-session consent', async () => {
  const f = await setup('no-load'); await f.send('a'); await until(() => f.started(1)); f.release(1); await until(() => f.tasks()[0].state === 'completed');
  await f.agent.control('pause'); await f.send('b'); await f.agent.close(); const reopened = f.make(); await reopened.check!(); await reopened.control('resume');
  await until(() => reopened.snapshot().tasks[1].state === 'error');
  expect(f.rpc().filter((message: any) => message.method === 'session/load')).toHaveLength(0);
  await reopened.control('new-session', reopened.snapshot().tasks[1].id);
  const c = await f.save('c'); await reopened.publish(f.session.file, [c]); await reopened.control('resume');
  await until(() => reopened.snapshot().tasks[2].state === 'completed');
});
test('non-normal ACP stop reasons block and pause without claiming an applied fix', async () => {
  const f = await setup('blocked'); const a = await f.send('a'); await f.send('b'); await until(() => f.started(1)); f.release(1);
  await until(() => f.tasks()[0].state === 'blocked'); expect(f.started(2)).toBe(false);
  expect((await f.session.readNote(f.session.file, a.id))!.status).toBe('pending');
});
test('revision identity round-trips through Markdown and ignores agent-only changes', async () => {
  const f = await setup(); const note = await f.save('a');
  const read = await f.session.readNote(f.session.file, note.id);
  expect(reviewerRevision(note)).toBe(reviewerRevision(read!));
  await f.session.answerRevision(f.session.file, note.id, 'Done', reviewerRevision(note), 'answered');
  expect((await f.session.readNote(f.session.file, note.id))!.status).toBe('answered');
});

test('real ACP streams can include progress prose before a final explicit verdict', () => {
  expect(acpAnswer('Reading the file.I will answer. {"status":"answered","body":"It exports value 734."}'))
    .toEqual({ status: 'answered', body: 'It exports value 734.' });
  expect(acpAnswer('Progress\n```json\n{"body":"Use `a{b}`.","status":"needs-input"}\n```'))
    .toEqual({ status: 'needs-input', body: 'Use `a{b}`.' });
  expect(acpAnswer('The requested fix is applied.')).toEqual({ body: 'The requested fix is applied.' });
  expect(acpAnswer('{"status":"applied","body":"Example"} Still working.').status).toBeUndefined();
});

test('cancelling while the pre-dispatch file read is pending never starts the task', async () => {
  const f = await setup(); await f.agent.control('pause'); await f.send('a');
  const read = f.session.readNote;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  f.session.readNote = async (...args) => { entered = true; await gate; return read(...args); };
  await f.agent.control('resume'); await until(() => entered);
  await f.agent.control('cancel', f.tasks()[0].id); release();
  await Bun.sleep(30);
  expect(f.tasks()[0].state).toBe('cancelled'); expect(f.started(1)).toBe(false);
  f.session.readNote = read;
});

test('reviewer reply withdrawal updates pending work without minting a new task', async () => {
  const f = await setup(); await f.agent.control('pause'); const a = await f.send('a');
  const reply = await f.session.reply(a.id, 'Follow-up to withdraw'); await f.agent.publish(f.session.file, [reply!]);
  const at = reply!.messages[0]!.at;
  const revised = await f.session.dropReply(a.id, at); await f.agent.revise(f.session.file, revised!);
  expect(f.tasks()).toHaveLength(1);
  expect(f.tasks()[0].revision).toBe(reviewerRevision(revised!));
  const before = f.tasks().length;
  await f.session.answer(f.session.file, a.id, 'External agent answer');
  expect(f.tasks()).toHaveLength(before);
});

test('a missing installed agent keeps its actionable startup error visible after cleanup', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lcr-missing-agent-')); roots.push(root);
  const agent = createManagedAgent({ repoRoot: root, outDir: '.review', directory: path.join(root, 'state'), session: createSession(root, '.review', 'HEAD'),
    config: { name: 'Missing', command: path.join(root, 'no-such-agent'), args: [] }, notify() {} });
  agents.push(agent); await agent.check!();
  expect(agent.status!().state).toBe('unavailable');
  expect(agent.status!().detail).toContain('no-such-agent');
});
