/**
 * Renderer output metrics harness.
 *
 *   node tools/render-metrics/index.mjs report [--mode <routing>] [--json]
 *   node tools/render-metrics/index.mjs assert
 *   node tools/render-metrics/index.mjs update
 *
 * See README.md in this directory for what is measured and why.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { computeMetrics, LOWER_IS_BETTER } from './metrics.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const rackdownRoot = resolve(toolDirectory, '../..');
const baselinePath = resolve(toolDirectory, 'baselines.json');
const coreDistPath = resolve(
  rackdownRoot,
  'packages/rackdown-core/dist/index.mjs',
);

const ROUTING_MODES = ['direct', 'orthogonal', 'lanes', 'perimeter'];

/** Documents measured. Ordered so the richest examples read first in report output. */
const CORPUS = [
  'examples/home-lab.rackdown',
  'examples/routing.rackdown',
  'examples/shared-rows.rackdown',
  'fixtures/valid/external-link.rackdown',
  'fixtures/valid/front-rear.rackdown',
  'fixtures/valid/rear-front.rackdown',
  'fixtures/valid/rear-only.rackdown',
  'fixtures/valid/fractional-u.rackdown',
  'fixtures/valid/u1-top.rackdown',
  'fixtures/valid/unicode.rackdown',
];

const METRIC_COLUMNS = [
  ['connections', 5],
  ['crossings', 10],
  ['occludedMm', 11],
  ['foreignRackTransitMm', 14],
  ['totalLengthMm', 12],
  ['bends', 6],
  ['viewportWidthMm', 10],
  ['viewportHeightMm', 11],
];

async function loadCore() {
  try {
    return await import(pathToFileURL(coreDistPath).href);
  } catch (error) {
    throw new Error(
      'Could not load @rackdown/core from dist. Build it first:\n' +
        '  pnpm --filter @rackdown/core build',
      { cause: error },
    );
  }
}

async function loadDeviceIndex() {
  // Optional: the harness measures geometry, and enrichment only changes it by
  // supplying U-heights and known ports. Missing devices must not fail the run.
  try {
    const devices = await import(
      pathToFileURL(
        resolve(rackdownRoot, 'packages/rackdown-devices/index.mjs'),
      ).href
    );
    return devices.deviceIndex ?? {};
  } catch {
    return {};
  }
}

async function measureCorpus(modes) {
  const { parse, resolve: resolveLayout, toSvg } = await loadCore();
  const deviceIndex = await loadDeviceIndex();
  const results = [];

  for (const relativePath of CORPUS) {
    const source = await readFile(resolve(rackdownRoot, relativePath), 'utf8');
    const layout = resolveLayout(parse(source), deviceIndex);

    for (const mode of modes) {
      // A fixed namespace keeps output stable; the auto-namespace hashes the
      // whole layout and would add noise to nothing that is measured here.
      const svg = toSvg(layout, {
        namespace: 'metrics',
        connectionRouting: mode,
      });
      results.push({
        document: relativePath,
        mode,
        ...computeMetrics(layout, svg),
      });
    }
  }

  return results;
}

function resultKey(result) {
  return `${result.document}::${result.mode}`;
}

function formatTable(results) {
  const header =
    'document'.padEnd(38) +
    'mode'.padEnd(12) +
    METRIC_COLUMNS.map(([name, width]) => shortName(name).padStart(width)).join(
      '',
    );
  const lines = [header, '-'.repeat(header.length)];

  let lastDocument;
  for (const result of results) {
    const document =
      result.document === lastDocument ? '' : shortDocument(result.document);
    lastDocument = result.document;
    lines.push(
      document.padEnd(38) +
        result.mode.padEnd(12) +
        METRIC_COLUMNS.map(([name, width]) =>
          String(result[name]).padStart(width),
        ).join(''),
    );
  }
  return lines.join('\n');
}

function shortDocument(path) {
  return path.replace(/^examples\//, '').replace(/^fixtures\/valid\//, 'fx/');
}

function shortName(name) {
  return name
    .replace(/Mm$/, '')
    .replace('foreignRackTransit', 'inForeign')
    .replace('viewportWidth', 'vpW')
    .replace('viewportHeight', 'vpH')
    .replace('totalLength', 'length');
}

async function readBaselines() {
  try {
    return JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch (error) {
    throw new Error(
      'No baselines.json. Create one with:\n' +
        '  node tools/render-metrics/index.mjs update',
      { cause: error },
    );
  }
}

async function commandReport(options) {
  const modes = options.mode ? [options.mode] : ROUTING_MODES;
  const results = await measureCorpus(modes);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return 0;
  }

  console.log(formatTable(results));
  console.log(
    '\nLower is better for every column except connections. ' +
      'See tools/render-metrics/README.md for what each measures.',
  );
  return 0;
}

async function commandAssert() {
  const baselines = await readBaselines();
  const tolerance = baselines.tolerance ?? {};
  const expected = new Map(
    baselines.entries.map((entry) => [resultKey(entry), entry]),
  );
  const results = await measureCorpus(ROUTING_MODES);

  const regressions = [];
  const improvements = [];
  const missing = [];

  for (const result of results) {
    const baseline = expected.get(resultKey(result));
    if (!baseline) {
      missing.push(resultKey(result));
      continue;
    }

    for (const metric of LOWER_IS_BETTER) {
      const actual = result[metric];
      const previous = baseline[metric];
      if (previous === undefined) {
        continue;
      }

      const allowed = toleranceFor(tolerance, metric, previous);
      if (actual > previous + allowed) {
        regressions.push({
          key: resultKey(result),
          metric,
          previous,
          actual,
          allowed,
        });
      } else if (actual < previous - allowed) {
        improvements.push({ key: resultKey(result), metric, previous, actual });
      }
    }
  }

  for (const entry of improvements) {
    console.log(
      `improved  ${entry.key}  ${entry.metric}: ${entry.previous} -> ${entry.actual}`,
    );
  }

  if (missing.length > 0) {
    console.error(
      `\nNo baseline for ${missing.length} result(s):\n  ${missing.join('\n  ')}`,
    );
  }

  if (regressions.length > 0) {
    console.error('\nRegressions:');
    for (const entry of regressions) {
      console.error(
        `  ${entry.key}\n    ${entry.metric}: ${entry.previous} -> ${entry.actual} (tolerance ${entry.allowed})`,
      );
    }
    console.error(
      '\nIf these changes are intended, review them and re-record with:\n' +
        '  node tools/render-metrics/index.mjs update',
    );
    return 1;
  }

  if (missing.length > 0) {
    return 1;
  }

  if (improvements.length > 0) {
    console.log(
      '\nNo regressions. Re-record the improvements with `update` once reviewed.',
    );
  } else {
    console.log('Renderer output metrics are within tolerance.');
  }
  return 0;
}

/** Absolute tolerance, or a proportion of the baseline where one is configured. */
function toleranceFor(tolerance, metric, previous) {
  const rule = tolerance[metric];
  if (rule === undefined) {
    return 0;
  }
  if (typeof rule === 'number') {
    return rule;
  }
  return Math.max(
    rule.absolute ?? 0,
    Math.round(Math.abs(previous) * (rule.relative ?? 0)),
  );
}

async function commandUpdate() {
  const existing = await readBaselines().catch(() => undefined);
  const results = await measureCorpus(ROUTING_MODES);
  const notes = new Map(
    (existing?.entries ?? [])
      .filter((entry) => entry.note)
      .map((entry) => [resultKey(entry), entry.note]),
  );

  const baselines = {
    $comment:
      'Recorded output of tools/render-metrics. Regenerate with `node tools/render-metrics/index.mjs update` and review the diff. These are current behaviour, not targets.',
    tolerance: existing?.tolerance ?? {
      totalLengthMm: { relative: 0.02 },
      viewportWidthMm: { absolute: 2 },
      viewportHeightMm: { absolute: 2 },
    },
    entries: results.map((result) => {
      const note = notes.get(resultKey(result));
      return note ? { ...result, note } : result;
    }),
  };

  await writeFile(baselinePath, `${JSON.stringify(baselines, null, 2)}\n`);
  console.log(
    `Recorded ${results.length} results to tools/render-metrics/baselines.json.`,
  );
  return 0;
}

function parseArguments(argv) {
  const options = { command: argv[0] ?? 'report', json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--mode') {
      const mode = argv[index + 1];
      if (!mode || !ROUTING_MODES.includes(mode)) {
        throw new Error(`--mode expects one of: ${ROUTING_MODES.join(', ')}`);
      }
      options.mode = mode;
      index += 1;
    } else {
      throw new Error(`Unrecognised argument: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  switch (options.command) {
    case 'report':
      return commandReport(options);
    case 'assert':
      return commandAssert();
    case 'update':
      return commandUpdate();
    default:
      throw new Error(
        `Unknown command: ${options.command}. Expected report, assert or update.`,
      );
  }
}

process.exitCode = await main();
