import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { context } from 'esbuild';
import { appDirectory, bundleOptions } from './bundle.mjs';

const host = option('--host') ?? '127.0.0.1';
const port = Number(option('--port') ?? '4173');

const routes = new Map([
  ['/', resolve(appDirectory, 'index.html')],
  ['/styles.css', resolve(appDirectory, 'src/styles.css')],
]);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid port: ${port}`);
}

const bundler = await context({ ...bundleOptions, write: false });

const server = createServer(async (request, response) => {
  const requestUrl = new URL(
    request.url ?? '/',
    `http://${request.headers.host ?? 'localhost'}`,
  );
  if (requestUrl.pathname === '/main.js') {
    try {
      const result = await bundler.rebuild();
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(result.outputFiles[0].contents);
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Playground build failed; see the terminal.');
    }
    return;
  }
  const file = routes.get(requestUrl.pathname);

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type':
      contentTypes.get(extname(file)) ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, host, () => {
  console.log(`RackDown playground: http://${host}:${port}`);
});
