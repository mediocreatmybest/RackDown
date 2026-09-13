import { readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  brotliCompressSync,
  gzipSync,
  constants as zlibConstants,
} from 'node:zlib';

import { build } from 'esbuild';

const packageDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(packageDir, 'dist');
const benchmarkDir = join(packageDir, '.catalogue-benchmark');

class StubPlugin {}

class StubMarkdownRenderChild {
  constructor(containerEl) {
    this.containerEl = containerEl;
  }
}

const obsidianStub = {
  Keymap: {
    isModEvent() {
      return false;
    },
  },
  MarkdownRenderChild: StubMarkdownRenderChild,
  Plugin: StubPlugin,
};

function humanBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function benchmark(operation, iterations = 15, warmups = 3) {
  for (let index = 0; index < warmups; index += 1) {
    operation();
  }

  const timings = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    operation();
    timings.push(performance.now() - start);
  }
  return median(timings);
}

function compressionSizes(source) {
  return {
    gzipBytes: gzipSync(source, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };
}

function executeBundle(script) {
  const module = { exports: {} };
  const context = vm.createContext({
    exports: module.exports,
    module,
    require(specifier) {
      if (specifier === 'obsidian') {
        return obsidianStub;
      }
      throw new TypeError(`Unexpected benchmark require: ${specifier}`);
    },
  });
  script.runInContext(context);
  return module.exports;
}

function formatMilliseconds(value) {
  return `${value.toFixed(2)} ms`;
}

async function fileBytes(path) {
  return (await stat(path)).size;
}

function renderMarkdown(report) {
  return (
    `# Obsidian catalogue loading experiment\n\n` +
    `This benchmark compares the current RackDown Obsidian plugin with the same plugin built by esbuild with the full pinned catalogue inlined, and with the unchanged plugin plus the same catalogue as a separate local JSON asset.\n\n` +
    `## Raw install shape\n\n` +
    `| Strategy | main.js | catalogue asset | total plugin files |\n` +
    `| --- | ---: | ---: | ---: |\n` +
    `| Baseline | ${humanBytes(report.baseline.mainJsBytes)} | none | ${humanBytes(report.baseline.installBytes)} |\n` +
    `| Inline full catalogue | ${humanBytes(report.inline.mainJsBytes)} | none | ${humanBytes(report.inline.installBytes)} |\n` +
    `| Separate local catalogue | ${humanBytes(report.separate.mainJsBytes)} | ${humanBytes(report.separate.catalogueBytes)} | ${humanBytes(report.separate.installBytes)} |\n\n` +
    `The inline and separate forms carry the same factual metadata. Their raw install footprints are therefore similar; the important difference is when the JavaScript engine must parse and materialize it.\n\n` +
    `## Directional load cost on the CI host\n\n` +
    `| Measurement | Median |\n` +
    `| --- | ---: |\n` +
    `| Compile baseline main.js | ${formatMilliseconds(report.baseline.compileMedianMs)} |\n` +
    `| Compile inline main.js | ${formatMilliseconds(report.inline.compileMedianMs)} |\n` +
    `| Execute baseline bundle with Obsidian stub | ${formatMilliseconds(report.baseline.executeMedianMs)} |\n` +
    `| Execute inline bundle with Obsidian stub | ${formatMilliseconds(report.inline.executeMedianMs)} |\n` +
    `| JSON.parse separate catalogue | ${formatMilliseconds(report.separate.jsonParseMedianMs)} |\n` +
    `| Read + JSON.parse separate catalogue | ${formatMilliseconds(report.separate.readAndParseMedianMs)} |\n\n` +
    `These timings are V8/Node 24 measurements on the self-hosted Linux CI runner. They are useful for relative direction only and are not Obsidian desktop or mobile startup benchmarks. V8 can lazily parse function bodies during compilation, so bundle execution is the stronger startup signal here: it forces the inline catalogue object to be materialized. The separate JSON cost is paid only when a future host loader chooses to read the asset.\n\n` +
    `## Distribution compression\n\n` +
    `| Payload | gzip-9 | Brotli-11 |\n` +
    `| --- | ---: | ---: |\n` +
    `| Baseline main.js | ${humanBytes(report.baseline.gzipBytes)} | ${humanBytes(report.baseline.brotliBytes)} |\n` +
    `| Inline main.js | ${humanBytes(report.inline.gzipBytes)} | ${humanBytes(report.inline.brotliBytes)} |\n` +
    `| Separate catalogue.json | ${humanBytes(report.separate.catalogueGzipBytes)} | ${humanBytes(report.separate.catalogueBrotliBytes)} |\n\n` +
    `## Decision signal\n\n` +
    `The separate local asset preserves a tiny startup JavaScript surface and defers catalogue parsing until the host actually asks for enriched hardware data. It keeps the full catalogue offline and bundled with the plugin while avoiding a mandatory multi-megabyte JavaScript parse and object materialization on every plugin load.\n\n` +
    `This experiment does not wire catalogue loading into the plugin and does not choose a final metadata schema. A real Obsidian desktop/mobile dogfood check is still required before catalogue integration is declared complete.\n`
  );
}

async function main() {
  const [catalogueArgument, jsonOutputArgument, markdownOutputArgument] =
    process.argv.slice(2);
  if (!catalogueArgument) {
    throw new TypeError(
      'Usage: node benchmark-catalogue.mjs <catalogue.json> [report.json] [report.md]',
    );
  }

  const cataloguePath = resolve(catalogueArgument);
  const baselinePath = join(distDir, 'main.js');
  const manifestPath = join(distDir, 'manifest.json');
  const stylesPath = join(distDir, 'styles.css');

  const catalogueSource = await readFile(cataloguePath, 'utf8');
  JSON.parse(catalogueSource);

  await rm(benchmarkDir, { recursive: true, force: true });
  await mkdir(benchmarkDir, { recursive: true });

  const inlineEntryPath = join(benchmarkDir, 'inline-entry.ts');
  const inlineMainPath = join(benchmarkDir, 'inline-main.js');
  await writeFile(
    inlineEntryPath,
    `import catalogue from ${JSON.stringify(cataloguePath)};\nexport { default } from '../src/main.ts';\nObject.defineProperty(globalThis, '__rackdownCatalogueBenchmark', { value: catalogue });\n`,
  );

  await build({
    absWorkingDir: packageDir,
    entryPoints: [inlineEntryPath],
    bundle: true,
    external: ['obsidian'],
    platform: 'browser',
    format: 'cjs',
    target: 'es2021',
    outfile: inlineMainPath,
  });

  const separateCataloguePath = join(benchmarkDir, 'catalogue.json');
  await copyFile(cataloguePath, separateCataloguePath);

  const [
    baselineSource,
    inlineSource,
    baselineMainBytes,
    inlineMainBytes,
    manifestBytes,
    stylesBytes,
    catalogueBytes,
  ] = await Promise.all([
    readFile(baselinePath, 'utf8'),
    readFile(inlineMainPath, 'utf8'),
    fileBytes(baselinePath),
    fileBytes(inlineMainPath),
    fileBytes(manifestPath),
    fileBytes(stylesPath),
    fileBytes(separateCataloguePath),
  ]);

  const baselineCompression = compressionSizes(baselineSource);
  const inlineCompression = compressionSizes(inlineSource);
  const catalogueCompression = compressionSizes(catalogueSource);
  const baselineScript = new vm.Script(baselineSource);
  const inlineScript = new vm.Script(inlineSource);

  const report = {
    schemaVersion: 2,
    node: process.version,
    baseline: {
      mainJsBytes: baselineMainBytes,
      installBytes: baselineMainBytes + manifestBytes + stylesBytes,
      compileMedianMs: benchmark(() => new vm.Script(baselineSource)),
      executeMedianMs: benchmark(() => executeBundle(baselineScript), 5, 1),
      ...baselineCompression,
    },
    inline: {
      mainJsBytes: inlineMainBytes,
      installBytes: inlineMainBytes + manifestBytes + stylesBytes,
      compileMedianMs: benchmark(() => new vm.Script(inlineSource)),
      executeMedianMs: benchmark(() => executeBundle(inlineScript), 5, 1),
      ...inlineCompression,
    },
    separate: {
      mainJsBytes: baselineMainBytes,
      catalogueBytes,
      installBytes:
        baselineMainBytes + manifestBytes + stylesBytes + catalogueBytes,
      jsonParseMedianMs: benchmark(() => JSON.parse(catalogueSource)),
      readAndParseMedianMs: benchmark(() =>
        JSON.parse(readFileSync(separateCataloguePath, 'utf8')),
      ),
      catalogueGzipBytes: catalogueCompression.gzipBytes,
      catalogueBrotliBytes: catalogueCompression.brotliBytes,
    },
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  process.stdout.write(markdown);

  if (jsonOutputArgument) {
    await writeFile(resolve(jsonOutputArgument), json);
  }
  if (markdownOutputArgument) {
    await writeFile(resolve(markdownOutputArgument), markdown);
  }
}

await main();
