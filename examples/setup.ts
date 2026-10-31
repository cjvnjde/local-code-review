import { cp, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const destination = path.join(here, 'repos');
const args = process.argv.slice(2);
if (args.length) {
  console.log('Usage: bun examples/setup.ts\nCreates missing demo repositories in examples/repos; existing folders are never changed.');
  process.exit(args.length === 1 && ['--help', '-h'].includes(args[0]!) ? 0 : 1);
}

async function git(root: string, ...args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error('git ' + args.join(' ') + ': ' + stderr);
  return stdout.trim();
}

async function change(root: string, file: string, before: string, after: string) {
  const target = path.join(root, file);
  const text = await readFile(target, 'utf8');
  if (!text.includes(before)) throw new Error('Template changed: ' + file);
  await writeFile(target, text.replace(before, after));
}

async function create(name: string, template: string, populate: (root: string) => Promise<void>) {
  const root = path.join(destination, name);
  const existing = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing) {
    console.log('Kept existing: ' + root);
    return;
  }
  await mkdir(root); // No recursive creation here: never overwrite an existing destination.
  await cp(path.join(here, 'templates', template), root, { recursive: true });
  await writeFile(path.join(root, '.gitignore'), '.review/\n');
  await git(root, 'init', '--template=', '--initial-branch=main');
  for (const [key, value] of Object.entries({
    'user.name': 'LCR Demo', 'user.email': 'demo@example.invalid',
    'commit.gpgsign': 'false', 'core.hooksPath': '.git/no-hooks',
    'core.excludesFile': '.git/no-excludes', 'core.autocrlf': 'false',
  })) await git(root, 'config', '--local', key, value);
  await writeFile(path.join(root, '.git/no-excludes'), '');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'Start demo project');
  await populate(root);
  console.log('Created: ' + root);
  console.log(await git(root, 'status', '--short', '--branch'));
}

await mkdir(destination, { recursive: true });
await create('working-tree', 'tasks', async root => {
  await git(root, 'switch', '-c', 'feature/task-summary');
  await change(root, 'src/tasks.ts', 'tasks.length;', 'tasks.filter(task => !task.done).length;');
  await writeFile(path.join(root, 'src/summary.ts'), "import { tasks, countOpen } from './tasks.ts';\n\nexport const summary = { open: countOpen(tasks), total: tasks.length };\n");
  await git(root, 'mv', 'docs/usage.txt', 'docs/quickstart.txt');
  await git(root, 'add', 'src/tasks.ts', 'src/summary.ts');
  await change(root, 'src/tasks.ts', 'Write release notes', 'Write and review release notes');
  await unlink(path.join(root, 'src/legacy.ts'));
  await writeFile(path.join(root, 'src/labels.ts'), "export const labels = ['bug', 'design', 'docs'];\n");
});
await create('branches', 'tasks', async root => {
  await git(root, 'switch', '-c', 'feature/search');
  await writeFile(path.join(root, 'src/search.ts'), "import type { Task } from './tasks.ts';\n\nexport function search(tasks: Task[], query: string): Task[] {\n  return tasks.filter(task => task.title.toLowerCase().includes(query.toLowerCase()));\n}\n");
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'Add task search');
  await change(root, 'src/search.ts', 'query.toLowerCase()', 'query.trim().toLowerCase()');
  await git(root, 'commit', '-am', 'Trim the search query');
  await git(root, 'switch', 'main');
  await change(root, 'src/tasks.ts', 'Write release notes', 'Publish release notes');
  await git(root, 'commit', '-am', 'Update the release task on main');
  await git(root, 'switch', '-c', 'feature/labels');
  await writeFile(path.join(root, 'src/labels.ts'), "export const labels = ['bug', 'design', 'docs'];\n");
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'Add task labels');
  await git(root, 'switch', 'feature/search');
});
await create('web-ui', 'web-ui', async root => {
  await git(root, 'switch', '-c', 'feature/dashboard-polish');
  await change(root, 'public/index.html', 'Your team, at a glance.', 'Make room for your next idea.');
  await git(root, 'commit', '-am', 'Try a new dashboard heading');
  await writeFile(path.join(root, 'public/styles.css'),
    await readFile(path.join(root, 'public/styles.css'), 'utf8') + '\n/* Work in progress: review the primary action and long card title. */\n#new-project { padding-inline: 10px; }\n.project-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n');
});
console.log('\nReady. See examples/README.md for review commands and UI scenarios.');
