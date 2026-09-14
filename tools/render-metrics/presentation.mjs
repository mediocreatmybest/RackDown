import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parse,
  resolve,
  toSvg,
} from '../../packages/rackdown-core/dist/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const siblings = (count) =>
  [
    'rack "Mini PCs" 6U',
    '4 device "Mini PC 01" as a',
    '4 device "Mini PC 02" as b',
    ...Array.from({ length: count }, (_, i) => `a:${i + 1} -- b:${i + 1}`),
  ].join('\n');
const callouts = (labels) =>
  [
    'rack "Callouts" 6U',
    '4 switch "Source" as source',
    ...labels.map((label) => `source -- external "${label}"`),
  ].join('\n');

export async function presentationCases() {
  const dense = await readFile(
    resolvePath(root, 'fixtures/valid/perimeter-dense.rackdown'),
    'utf8',
  );
  return [
    ['two-mini-pcs', siblings(1)],
    ['three-c3-connections', siblings(3)],
    ['top-overflow', siblings(4)],
    [
      'garage',
      await readFile(
        resolvePath(root, 'fixtures/valid/perimeter-garage.rackdown'),
        'utf8',
      ),
    ],
    [
      'six-callouts',
      callouts(Array.from({ length: 6 }, (_, i) => `Outlet ${i + 1}`)),
    ],
    ['eighteen-callouts', dense],
    [
      'wide-labels',
      callouts([
        'Garage GPO',
        'IEC power reference',
        'W'.repeat(24),
        'i'.repeat(24),
        '012345678901234567890123',
        '<&> punctuation & symbols',
      ]),
    ],
    [
      'unicode-labels',
      callouts([
        '车库电源插座不间断电源设备连接',
        '🔌 Garage ⚡ UPS',
        '👨‍👩‍👧‍👦 Garage',
        '🇦🇺🇺🇸🇬🇧',
        'Café power',
        'العربية',
        'אבגדהוז',
      ]),
    ],
  ].map(([name, source]) => {
    const layout = resolve(parse(source));
    return {
      name,
      source,
      layout,
      svg: toSvg(layout, {
        namespace: name,
        connectionRouting: 'perimeter',
        sizing: 'responsive',
        theme: 'light',
      }),
    };
  });
}

async function generate(directory) {
  await mkdir(directory, { recursive: true });
  const cases = await presentationCases();
  for (const { name, source, svg } of cases) {
    await writeFile(resolvePath(directory, `${name}.rackdown`), source);
    await writeFile(resolvePath(directory, `${name}.svg`), svg);
  }
  await writeFile(
    resolvePath(directory, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Perimeter presentation review</title><style>body{font:16px Arial;background:#fff;color:#111;margin:24px}section{max-width:1100px;margin:32px auto}svg{width:100%;height:auto;border:1px solid #ddd}</style>${cases.map(({ name, svg }) => `<section><h2>${name}</h2>${svg}</section>`).join('\n')}`,
  );
  console.log(`Wrote ${cases.length} SVG review cases to ${directory}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href
) {
  if (!process.argv[2])
    throw new Error(
      'Usage: node tools/render-metrics/presentation.mjs <output-directory>',
    );
  await generate(resolvePath(process.argv[2]));
}
