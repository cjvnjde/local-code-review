import { tasks, countOpen } from './tasks.ts';

console.log('Open tasks: ' + countOpen(tasks));
for (const task of tasks) console.log((task.done ? '[x] ' : '[ ] ') + task.title);
