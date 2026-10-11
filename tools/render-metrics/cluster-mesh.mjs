import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parse,
  resolve,
  toSvg,
} from '../../packages/rackdown-core/dist/index.mjs';
import { computeMetrics } from './metrics.mjs';

export function clusterCases(core = { parse, resolve, toSvg }) {
  return [3, 4].flatMap((count) =>
    [false, true].map((shelf) => {
      const name = `${count}-node-${shelf ? 'shelf' : 'stacked'}`;
      const source = readFileSync(
        new URL(
          `../../fixtures/valid/cluster-${count}-${shelf ? 'shelf' : 'stacked'}.rackdown`,
          import.meta.url,
        ),
        'utf8',
      );
      const layout = core.resolve(core.parse(source));
      const svg = core.toSvg(layout, {
        namespace: name,
        connectionRouting: 'perimeter',
        theme: 'light',
        sizing: 'responsive',
      });
      return { name, source, layout, svg };
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href
) {
  const directory = resolvePath(
    process.argv[2] ?? 'examples/generated/cluster-mesh',
  );
  await mkdir(directory, { recursive: true });
  const referenceCore = process.argv[3]
    ? await import(pathToFileURL(resolvePath(process.argv[3])).href)
    : undefined;
  const cases = clusterCases(referenceCore);
  for (const { name, source, layout, svg } of cases) {
    await writeFile(resolvePath(directory, `${name}.rackdown`), source);
    await writeFile(resolvePath(directory, `${name}.svg`), svg);
    console.log(name, computeMetrics(layout, svg));
  }
  await writeFile(
    resolvePath(directory, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Cluster meshes</title><style>body{font:16px system-ui;background:#f5f6f8;color:#172033;margin:32px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;max-width:1500px;margin:auto}section{background:white;padding:24px;border-radius:12px}svg{width:100%;height:auto}h1{text-align:center}</style><h1>${referenceCore ? 'Original' : 'Nested'} cluster routing</h1><main>${cases.map(({ name, svg }) => `<section><h2>${name}</h2>${svg}</section>`).join('')}</main>`,
  );
}
