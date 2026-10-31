import path from 'node:path';

const assets: Record<string, string> = {
  '/': 'index.html',
  '/settings': 'index.html',
  '/styles.css': 'styles.css',
  '/app.js': 'app.js',
  '/logo.svg': 'logo.svg',
};
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const pathname = new URL(request.url).pathname;
    if (!Object.hasOwn(assets, pathname)) return new Response('Not found', { status: 404 });
    const file = Bun.file(path.join(import.meta.dir, 'public', assets[pathname]!));
    return new Response(request.method === 'HEAD' ? null : file, {
      headers: { 'cache-control': 'no-store', 'content-type': file.type },
    });
  },
});
console.log('LCR UI demo: http://127.0.0.1:' + server.port);
