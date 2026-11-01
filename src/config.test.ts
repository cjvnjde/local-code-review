import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAcpPath, userConfigFile } from './config.ts';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lcr-config-')); roots.push(root);
  const settings = path.join(root, 'lcr', 'config.json'); await mkdir(path.dirname(settings));
  return { root, settings, write: (value: unknown) => writeFile(settings, JSON.stringify(value)) };
}
test('user settings follow absolute XDG configuration roots with the home fallback', () => {
  expect(userConfigFile({}, '/user')).toBe('/user/.config/lcr/config.json');
  expect(userConfigFile({ XDG_CONFIG_HOME: '/configuration' }, '/user')).toBe('/configuration/lcr/config.json');
  expect(userConfigFile({ XDG_CONFIG_HOME: 'relative' }, '/user')).toBe('/user/.config/lcr/config.json');
  expect(userConfigFile({ XDG_CONFIG_HOME: '' }, '/user')).toBe('/user/.config/lcr/config.json');
});
test('no settings, no default, and explicit null keep manual operation available', async () => {
  const f = await fixture(); expect(await resolveAcpPath({}, '/repo', f.settings)).toBeNull();
  await f.write({}); expect(await resolveAcpPath({}, '/repo', f.settings)).toBeNull();
  await f.write({ acp: null }); expect(await resolveAcpPath({}, '/repo', f.settings)).toBeNull();
});
test('a default profile is resolved beside its user settings across repositories', async () => {
  const f = await fixture(); await f.write({ acp: 'agents/omp.json' });
  const expected = path.join(f.root, 'lcr/agents/omp.json');
  expect(await resolveAcpPath({}, '/first/repo', f.settings)).toBe(expected);
  expect(await resolveAcpPath({}, '/another/repo', f.settings)).toBe(expected);
});
test('explicit profiles keep repository-relative semantics and bypass a malformed default', async () => {
  const f = await fixture(); await writeFile(f.settings, 'invalid JSON');
  expect(await resolveAcpPath({ acp: 'agent.json' }, '/repo', f.settings)).toBe('/repo/agent.json');
  expect(await resolveAcpPath({ acp: '/elsewhere/agent.json' }, '/repo', f.settings)).toBe('/elsewhere/agent.json');
});
test('no-agent bypasses invalid settings without reading or launching the configured profile', async () => {
  const f = await fixture(); await f.write({ acp: 123 });
  expect(await resolveAcpPath({ noAgent: true }, '/repo', f.settings)).toBeNull();
  expect(await resolveAcpPath({ noAgent: true, acp: 'agent.json' }, '/repo', f.settings)).toBeNull();
});
test('absolute and home-relative profile paths are supported in settings', async () => {
  const f = await fixture(); await f.write({ acp: '/agents/custom.json' });
  expect(await resolveAcpPath({}, '/repo', f.settings)).toBe('/agents/custom.json');
  await f.write({ acp: '~/agents/custom.json' });
  expect(await resolveAcpPath({}, '/repo', f.settings)).toBe(path.join(homedir(), 'agents/custom.json'));
});
test('invalid settings fail visibly rather than silently changing to a manual review', async () => {
  const f = await fixture(); await writeFile(f.settings, '{');
  await expect(resolveAcpPath({}, '/repo', f.settings)).rejects.toThrow('Invalid JSON');
  for (const invalid of [[], null, false, { acp: '' }, { acp: ' ' }, { acp: false }, { acp: {} }]) {
    await f.write(invalid); await expect(resolveAcpPath({}, '/repo', f.settings)).rejects.toThrow(f.settings);
  }
});
