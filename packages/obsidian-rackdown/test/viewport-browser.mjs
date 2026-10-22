// Run from any directory: node packages/obsidian-rackdown/test/viewport-browser.mjs
// Open the printed URL. Tests run in the browser and report PASS/FAIL on the page.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/tests.js') {
      const result = await build({
        entryPoints: [fileURLToPath(new URL('test/viewport-browser.js', root))],
        bundle: true,
        format: 'esm',
        write: false,
        plugins: [
          {
            name: 'obsidian-lifecycle-stub',
            setup(builder) {
              builder.onResolve({ filter: /^obsidian$/ }, () => ({
                path: 'obsidian',
                namespace: 'stub',
              }));
              builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                contents:
                  'export class MarkdownRenderChild { constructor(containerEl) { this.containerEl = containerEl; } }',
              }));
            },
          },
        ],
      });
      response.setHeader('Content-Type', 'text/javascript');
      response.end(result.outputFiles[0].text);
      return;
    }
    const css = await readFile(new URL('styles.css', root), 'utf8');
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>RackDown scrollbar regression</title><style>${css}
      body { font: 16px system-ui; margin: 24px; }
      .rackdown-block { margin: 12px 0; }
      .rackdown-diagram { outline: 1px solid #888; }
      .rackdown-rack { fill: #dbeafe; stroke: #334155; stroke-width: 0; }
      pre { white-space: pre-wrap; }
    </style><h1>RackDown scrollbar regression</h1><pre id="results">Running…</pre><div id="fixtures"></div><script type="module" src="tests.js"></script></html>`);
  } catch (error) {
    console.error('RackDown viewport regression server failed:', error);
    response.statusCode = 500;
    response.end('Internal server error');
  }
});
server.listen(4180, '127.0.0.1', () =>
  console.log('Open http://127.0.0.1:4180'),
);
