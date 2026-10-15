import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const sourceScript = resolve(sourceDirectory, 'stage.mjs');

function write(path, contents = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function createWorkspace({ complete = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rackdown-stage-test-'));
  const repository = join(root, 'repo');
  const script = join(repository, 'tools/release/stage.mjs');

  mkdirSync(dirname(script), { recursive: true });
  cpSync(sourceScript, script);
  write(
    join(repository, 'package.json'),
    `${JSON.stringify({ name: 'rackdown-test', version: '1.0.0' })}\n`,
  );

  if (complete) {
    write(
      join(repository, 'packages/obsidian-rackdown/dist/manifest.json'),
      `${JSON.stringify({
        id: 'rackdown',
        version: '1.0.0',
        minAppVersion: '1.0.0',
      })}\n`,
    );
    write(
      join(repository, 'packages/obsidian-rackdown/dist/main.js'),
      'export {};\n',
    );
    write(join(repository, 'packages/obsidian-rackdown/dist/styles.css'), '');

    for (const [directory, name, files] of [
      ['rackdown-core', '@rackdown/core', []],
      ['rackdown-devices', '@rackdown/devices', []],
      ['rackdown-cli', '@rackdown/cli', ['dist']],
    ]) {
      write(
        join(repository, 'packages', directory, 'package.json'),
        `${JSON.stringify({ name, version: '1.0.0', files })}\n`,
      );
    }
    write(
      join(repository, 'packages/rackdown-cli/dist/cli.mjs'),
      'export {};\n',
    );
    mkdirSync(join(repository, 'examples'), { recursive: true });
    write(join(repository, 'LICENSE'), 'test licence\n');
    write(
      join(repository, 'upstream/netbox.lock.json'),
      `${JSON.stringify({ source: 'test/source', ref: 'test-ref' })}\n`,
    );
    write(
      join(repository, 'upstream/netbox/LICENSE.txt'),
      'upstream licence\n',
    );
  }

  return { repository, root, script };
}

function runStage(workspace, args = []) {
  return spawnSync(process.execPath, [workspace.script, ...args], {
    cwd: sourceDirectory,
    encoding: 'utf8',
  });
}

function clean(workspace) {
  rmSync(workspace.root, { recursive: true, force: true });
}

test('rejects the repository root without deleting its sentinel', () => {
  const workspace = createWorkspace();
  const sentinel = join(workspace.repository, 'sentinel.txt');
  write(sentinel, 'preserve me');

  try {
    const result = runStage(workspace, ['--out', '.']);

    assert.notEqual(result.status, 0);
    assert.equal(existsSync(sentinel), true);
    assert.match(result.stderr, /unsafe release staging destination/i);
  } finally {
    clean(workspace);
  }
});

test('rejects parent and outside directories without deleting sentinels', () => {
  for (const output of ['..', 'outside']) {
    const workspace = createWorkspace();
    const destination =
      output === '..' ? workspace.root : join(workspace.root, output);
    const sentinel = join(destination, 'sentinel.txt');
    write(sentinel, 'preserve me');

    try {
      const result = runStage(workspace, [
        '--out',
        output === '..' ? output : destination,
      ]);

      assert.notEqual(result.status, 0);
      assert.equal(existsSync(sentinel), true);
      assert.match(result.stderr, /unsafe release staging destination/i);
    } finally {
      clean(workspace);
    }
  }
});

test('rejects existing project and nested staging directories', () => {
  for (const output of ['packages', 'release-staging/nested']) {
    const workspace = createWorkspace();
    const sentinel = join(workspace.repository, output, 'sentinel.txt');
    write(sentinel, 'preserve me');

    try {
      const result = runStage(workspace, ['--out', output]);

      assert.notEqual(result.status, 0);
      assert.equal(existsSync(sentinel), true);
      assert.match(result.stderr, /unsafe release staging destination/i);
    } finally {
      clean(workspace);
    }
  }
});

test('rejects missing and empty --out values', () => {
  for (const args of [['--out'], ['--out', '']]) {
    const workspace = createWorkspace({ complete: true });
    const sentinel = join(workspace.repository, 'sentinel.txt');
    write(sentinel, 'preserve me');

    try {
      const result = runStage(workspace, args);

      assert.notEqual(result.status, 0);
      assert.equal(existsSync(sentinel), true);
      assert.match(result.stderr, /--out requires a directory/i);
    } finally {
      clean(workspace);
    }
  }
});

test('rejects an existing symlink staging destination', () => {
  const workspace = createWorkspace({ complete: true });
  const target = join(workspace.root, 'outside');
  const sentinel = join(target, 'sentinel.txt');
  write(sentinel, 'preserve me');
  symlinkSync(
    target,
    join(workspace.repository, 'release-staging'),
    'junction',
  );

  try {
    const result = runStage(workspace);

    assert.notEqual(result.status, 0);
    assert.equal(existsSync(sentinel), true);
    assert.match(result.stderr, /unsafe release staging destination/i);
  } finally {
    clean(workspace);
  }
});

for (const output of ['release-staging', 'release-staging-ci_1']) {
  const args = output === 'release-staging' ? [] : ['--out', output];

  test(`rejects an ordinary file at ${output} without changing it`, () => {
    const workspace = createWorkspace({ complete: true });
    const destination = join(workspace.repository, output);
    const contents = Buffer.from('preserve this staging file\n');
    write(destination, contents);

    try {
      const result = runStage(workspace, args);

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /unsafe release staging destination/i);
      assert.deepEqual(readFileSync(destination), contents);
    } finally {
      clean(workspace);
    }
  });

  test(`recreates an existing directory at ${output}`, () => {
    const workspace = createWorkspace({ complete: true });
    const destination = join(workspace.repository, output);
    const staleFile = join(destination, 'stale.txt');
    write(staleFile, 'old staging output');

    try {
      const result = runStage(workspace, args);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(staleFile), false);
      assert.equal(existsSync(join(destination, 'MANIFEST.json')), true);
    } finally {
      clean(workspace);
    }
  });
}

test('permits the default staging destination', () => {
  const workspace = createWorkspace({ complete: true });

  try {
    const result = runStage(workspace);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      existsSync(join(workspace.repository, 'release-staging/MANIFEST.json')),
      true,
    );
  } finally {
    clean(workspace);
  }
});

test('permits a valid named staging destination', () => {
  const workspace = createWorkspace({ complete: true });
  const output = 'release-staging-ci_1';

  try {
    const result = runStage(workspace, ['--out', output]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      existsSync(join(workspace.repository, output, 'MANIFEST.json')),
      true,
    );
  } finally {
    clean(workspace);
  }
});

test('permits an absolute valid staging destination after resolving it', () => {
  const workspace = createWorkspace({ complete: true });
  const repository =
    process.platform === 'win32'
      ? workspace.repository.toUpperCase()
      : workspace.repository;
  const output = join(repository, 'release-staging-absolute');

  try {
    const result = runStage(workspace, ['--out', output]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(output, 'MANIFEST.json')), true);
  } finally {
    clean(workspace);
  }
});

test('permits an existing valid staging destination after resolving it', {
  skip: process.platform !== 'win32',
}, () => {
  const workspace = createWorkspace({ complete: true });
  const existingOutput = join(workspace.repository, 'release-staging-CI');
  mkdirSync(existingOutput);

  try {
    const result = runStage(workspace, [
      '--out',
      join(workspace.repository, 'release-staging-ci'),
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(existingOutput, 'MANIFEST.json')), true);
  } finally {
    clean(workspace);
  }
});
