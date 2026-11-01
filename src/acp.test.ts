import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AcpClient, acpTarget, readAcpConfig } from './acp.ts';
const roots: string[] = []; const clients: AcpClient[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const root = () => { const directory = mkdtempSync(path.join(tmpdir(), 'lcr-acp-')); roots.push(directory); return directory; };
function peer(mode: string) {
  const directory = root(); const client = new AcpClient({ name: 'External', command: process.execPath, args: [path.join(import.meta.dir, 'fixtures/acp-agent.ts')], env: { LCR_ACP_FIXTURE: directory, LCR_ACP_MODE: mode } }, directory,
    { update() {}, permission() {}, lost() {} }); clients.push(client); return client;
}
test('generic configuration validates argv and environment without vendor ids or shell parsing', async () => {
  const file = path.join(root(), 'config.json');
  writeFileSync(file, JSON.stringify({ name: 'Another agent', command: '/path/with spaces/acp', args: ['--some-option', 'literal $(text)'] }));
  const config = await readAcpConfig(file); expect(config.args[1]).toBe('literal $(text)');
  expect(acpTarget({ ...config, env: { B: '2', A: '1' } })).toBe(acpTarget({ ...config, env: { A: '1', B: '2' } }));
  for (const invalid of [{ name: '', command: 'agent' }, { name: 'Agent', command: 'agent', args: '--shell' }, { name: 'Agent', command: 'agent', env: { KEY: 1 } }]) {
    writeFileSync(file, JSON.stringify(invalid)); await expect(readAcpConfig(file)).rejects.toThrow('ACP config');
  }
});
test('unsupported protocol versions close the connection instead of using draft methods', async () => {
  const client = peer('version'); await expect(client.start()).rejects.toThrow('Unsupported ACP version 2');
});
test('external authentication failures are visible and never trigger an authentication bypass', async () => {
  const client = peer('auth'); await client.start(); await expect(client.session()).rejects.toThrow('Authentication required');
});
