const $ = selector => document.querySelector(selector);
const settingsPage = location.pathname === '/settings';
$('#dashboard').hidden = settingsPage;
$('#settings').hidden = !settingsPage;
document.title = (settingsPage ? 'Settings' : 'Projects') + ' · Fieldwork';

$('#new-project').addEventListener('click', () => $('#project-dialog').showModal());
$('#cancel-project').addEventListener('click', () => $('#project-dialog').close());
$('#project-filter').addEventListener('input', filterProjects);
function filterProjects() {
  const query = $('#project-filter').value.trim().toLowerCase();
  const projects = [...document.querySelectorAll('.project')];
  for (const project of projects) project.hidden = !project.dataset.name.toLowerCase().includes(query);
  $('#empty').hidden = projects.some(project => !project.hidden);
}
$('#projects').addEventListener('change', event => {
  if (!event.target.matches('.complete')) return;
  event.target.closest('.project').classList.toggle('done', event.target.checked);
});
$('#project-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#project-name').value.trim();
  if (!name) return;
  const card = document.querySelector('.project').cloneNode(true);
  card.dataset.name = name;
  card.querySelector('h3').textContent = name;
  card.querySelector('.badge').textContent = 'New';
  card.querySelector('p').textContent = 'Ready for your first task.';
  card.classList.remove('done');
  card.querySelector('input').checked = false;
  $('#projects').append(card);
  $('#project-count').textContent = String(document.querySelectorAll('.project').length);
  $('#project-dialog').close();
  event.target.reset();
  filterProjects();
  $('#notice').textContent = 'Created project: ' + name;
});
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  $('#notice').textContent = 'Saved settings for ' + $('#workspace-name').value + ' in this tab. Reload resets the demo.';
});

const canvas = $('#activity-chart');
const context = canvas.getContext('2d');
const values = [8, 14, 10, 19, 16];
context.font = '16px system-ui';
values.forEach((value, i) => {
  const x = 50 + i * 175;
  context.fillStyle = '#398464';
  context.fillRect(x, 170 - value * 7, 90, value * 7);
  context.fillStyle = '#63716a';
  context.fillText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i], x + 24, 194);
});
