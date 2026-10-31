export type Task = { id: number; title: string; done: boolean };

export const tasks: Task[] = [
  { id: 1, title: 'Write release notes', done: false },
  { id: 2, title: 'Review the dashboard', done: true },
  { id: 3, title: 'Check keyboard navigation', done: false },
];

export function countOpen(tasks: Task[]): number {
  return tasks.length;
}
