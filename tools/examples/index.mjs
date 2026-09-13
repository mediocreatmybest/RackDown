// Dogfood the public examples through the real @rackdown/cli binary.
//
//   node tools/examples/index.mjs check     rackdown check every canonical example
//   node tools/examples/index.mjs render    render every canonical example (smoke test)
//   node tools/examples/index.mjs generate  write the declared committed SVGs
//   node tools/examples/index.mjs verify    compare committed SVGs with a fresh render
//   node tools/examples/index.mjs ci        check + render + verify
//
// examples/examples.json declares which renders are committed. The .rackdown
// sources stay authoritative; generated SVG is a derived artefact.

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const rackdownRoot = resolve(toolDirectory, '../..');
const examplesRoot = resolve(rackdownRoot, 'examples');
const configPath = resolve(examplesRoot, 'examples.json');
const cliPath = resolve(rackdownRoot, 'packages/rackdown-cli/dist/cli.mjs');

const USAGE = `Usage: node tools/examples/index.mjs <check|render|generate|verify|ci>`;

function readConfig() {
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new Error(`Missing examples manifest at ${configPath}.`, {
      cause: error,
    });
  }

  const config = JSON.parse(raw);
  const generatedDirectory = config.generatedDirectory ?? 'generated';
  const defaultOptions = config.defaultRenderOptions ?? [];
  const generated = config.generated ?? [];

  if (!Array.isArray(generated)) {
    throw new TypeError('examples.json: "generated" must be an array.');
  }

  for (const entry of generated) {
    if (
      typeof entry?.source !== 'string' ||
      typeof entry?.output !== 'string'
    ) {
      throw new TypeError(
        'examples.json: each "generated" entry needs string "source" and "output".',
      );
    }
  }

  return {
    generatedDirectory,
    defaultOptions,
    generated: generated.map((entry) => ({
      source: entry.source,
      output: entry.output,
      options: entry.options ?? defaultOptions,
    })),
  };
}

// Canonical examples are every .rackdown file directly under examples/, so a
// future example-cleanup task only has to add or remove files.
function canonicalExamples() {
  return readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.rackdown'))
    .map((entry) => entry.name)
    .sort();
}

function requireCli() {
  try {
    readFileSync(cliPath);
  } catch (error) {
    throw new Error(
      `@rackdown/cli is not built. Run "pnpm --filter @rackdown/cli build" first (expected ${cliPath}).`,
      { cause: error },
    );
  }
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: rackdownRoot,
    encoding: 'utf8',
  });

  if (result.error) throw result.error;
  return result;
}

function reportCliFailure(label, result) {
  const output = `${result.stderr ?? ''}`.trimEnd();
  console.error(`  FAIL ${label} (exit ${result.status})`);
  if (output) {
    for (const line of output.split('\n')) console.error(`       ${line}`);
  }
}

function checkExamples() {
  const examples = canonicalExamples();
  if (examples.length === 0) {
    throw new Error('No canonical examples found under examples/.');
  }

  console.log(`rackdown check: ${examples.length} canonical example(s)`);
  const failures = [];

  for (const name of examples) {
    const result = runCli(['check', join('examples', name)]);
    if (result.status === 0) {
      console.log(`  ok   ${name}`);
    } else {
      failures.push(name);
      reportCliFailure(name, result);
    }
  }

  return failures;
}

function renderExamples(outputDirectory, options) {
  const examples = canonicalExamples();
  console.log(`rackdown render: ${examples.length} canonical example(s)`);
  mkdirSync(outputDirectory, { recursive: true });
  const failures = [];

  for (const name of examples) {
    const output = join(
      outputDirectory,
      `${name.replace(/\.rackdown$/, '')}.svg`,
    );
    const result = runCli([
      'render',
      join('examples', name),
      '-o',
      output,
      ...options,
    ]);

    if (result.status === 0) {
      console.log(`  ok   ${name}`);
    } else {
      failures.push(name);
      reportCliFailure(name, result);
    }
  }

  return failures;
}

function renderDeclared(config, outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  const rendered = new Map();
  const failures = [];

  for (const entry of config.generated) {
    const sourcePath = join('examples', entry.source);
    const outputPath = resolve(outputDirectory, entry.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    const result = runCli([
      'render',
      sourcePath,
      '-o',
      outputPath,
      ...entry.options,
    ]);

    if (result.status !== 0) {
      failures.push(entry.output);
      reportCliFailure(`${entry.source} -> ${entry.output}`, result);
      continue;
    }

    rendered.set(entry.output, readFileSync(outputPath));
  }

  return { rendered, failures };
}

function committedGeneratedFiles(config) {
  const directory = resolve(examplesRoot, config.generatedDirectory);
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.svg'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function generate(config) {
  const directory = resolve(examplesRoot, config.generatedDirectory);

  if (config.generated.length === 0) {
    console.log(
      'No generated renders declared in examples/examples.json; nothing to write.',
    );
    return 0;
  }

  const temporary = mkdtempSync(join(tmpdir(), 'rackdown-examples-'));
  try {
    const { rendered, failures } = renderDeclared(config, temporary);
    if (failures.length > 0) {
      console.error(`Failed to render ${failures.length} declared example(s).`);
      return 1;
    }

    mkdirSync(directory, { recursive: true });
    for (const [name, content] of rendered) {
      const target = resolve(directory, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      console.log(`  wrote ${config.generatedDirectory}/${name}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  return 0;
}

function verify(config) {
  const directory = resolve(examplesRoot, config.generatedDirectory);
  const declared = config.generated.map((entry) => entry.output).sort();
  const committed = committedGeneratedFiles(config);

  if (declared.length === 0 && committed.length === 0) {
    console.log(
      'No generated renders declared or committed yet; generated SVG verification is a no-op.',
    );
    return 0;
  }

  const problems = [];

  for (const name of committed) {
    if (!declared.includes(name)) {
      problems.push(
        `${config.generatedDirectory}/${name} is committed but not declared in examples/examples.json.`,
      );
    }
  }

  const temporary = mkdtempSync(join(tmpdir(), 'rackdown-examples-'));
  try {
    const { rendered, failures } = renderDeclared(config, temporary);
    for (const name of failures) {
      problems.push(`${name} could not be rendered from its source.`);
    }

    for (const [name, expected] of rendered) {
      let actual;
      try {
        actual = readFileSync(resolve(directory, name));
      } catch {
        problems.push(
          `${config.generatedDirectory}/${name} is declared but not committed. Run "pnpm examples:generate" and commit the result.`,
        );
        continue;
      }

      if (actual.equals(expected)) {
        console.log(`  ok   ${config.generatedDirectory}/${name}`);
      } else {
        problems.push(
          `${config.generatedDirectory}/${name} is stale (${actual.length} committed bytes vs ${expected.length} rendered bytes). Run "pnpm examples:generate" and commit the result in the same PR.`,
        );
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    console.error('Generated example SVG verification failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  console.log(
    `Generated example SVGs are current (${declared.length} file(s)).`,
  );
  return 0;
}

function smoke(config) {
  const temporary = mkdtempSync(join(tmpdir(), 'rackdown-examples-'));
  try {
    const failures = renderExamples(temporary, config.defaultOptions);
    if (failures.length > 0) {
      console.error(
        `Failed to render ${failures.length} canonical example(s).`,
      );
      return 1;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  return 0;
}

const command = process.argv[2];
if (command === undefined) {
  console.error(USAGE);
  process.exit(2);
}

requireCli();
const config = readConfig();
let exitCode = 0;

switch (command) {
  case 'check': {
    const failures = checkExamples();
    if (failures.length > 0) {
      console.error(`rackdown check failed for ${failures.length} example(s).`);
      exitCode = 1;
    }
    break;
  }
  case 'render':
    exitCode = smoke(config);
    break;
  case 'generate':
    exitCode = generate(config);
    break;
  case 'verify':
    exitCode = verify(config);
    break;
  case 'ci': {
    const failures = checkExamples();
    exitCode = failures.length > 0 ? 1 : 0;
    exitCode = smoke(config) || exitCode;
    exitCode = verify(config) || exitCode;
    break;
  }
  default:
    console.error(`Unknown command "${command}".\n${USAGE}`);
    exitCode = 2;
}

process.exitCode = exitCode;
