// Build core first: pnpm --filter @rackdown/core build
// Run: node packages/rackdown-core/test/style-isolation-browser.mjs
// Open the printed URL in light and dark browser colour-scheme modes.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const routes = new Map([
  ['/core.mjs', new URL('../dist/index.mjs', import.meta.url)],
  ['/tests.js', new URL('./style-isolation-browser.js', import.meta.url)],
]);
const server = createServer(async (request, response) => {
  try {
    const file = routes.get(request.url);
    if (file) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(file));
      return;
    }
    if (request.url !== '/') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>RackDown SVG style isolation regression</title><h1>RackDown SVG style isolation regression</h1><pre id="results">Running…</pre><div id="fixtures"></div><script type="module" src="/tests.js"></script></html>`,
    );
  } catch (error) {
    console.error('RackDown style isolation regression server failed:', error);
    response.writeHead(500).end('Internal server error');
  }
});
server.listen(Number(process.env.PORT ?? 4181), '127.0.0.1', () => {
  console.log(`Open http://127.0.0.1:${server.address().port}`);
});
