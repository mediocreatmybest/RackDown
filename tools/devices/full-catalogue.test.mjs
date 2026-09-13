import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  generateFullCatalogue,
  verifyFullCatalogue,
} from './full-catalogue.mjs';

test('full catalogue generation and verification enforce a clean exact pin', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rackdown-full-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'upstream');
  await mkdir(checkout);
  const git = (...args) =>
    execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  await mkdir(join(checkout, 'device-types'));
  await mkdir(join(checkout, 'rack-types'));
  const devicePath = join(checkout, 'device-types', 'example.yaml');
  const yaml = 'slug: example\nmodel: Example\nu_height: 1\n';
  await writeFile(devicePath, yaml);
  await writeFile(
    join(checkout, 'device-types', 'second.yaml'),
    'slug: another\nu_height: 2\n',
  );
  // Slugs whose English collation order differs from code-unit order. Filenames
  // stay distinct so the fixture also works on case-insensitive filesystems.
  await writeFile(
    join(checkout, 'device-types', 'upper-a.yaml'),
    'slug: A\nu_height: 1\n',
  );
  await writeFile(
    join(checkout, 'device-types', 'upper-b.yaml'),
    'slug: B\nu_height: 1\n',
  );
  await writeFile(
    join(checkout, 'device-types', 'underscore.yaml'),
    'slug: _x\nu_height: 1\n',
  );
  await writeFile(
    join(checkout, 'device-types', 'lower-a.yaml'),
    'slug: a\nu_height: 1\n',
  );
  await writeFile(
    join(checkout, 'device-types', 'lower-z.yaml'),
    'slug: z\nu_height: 1\n',
  );
  await writeFile(
    join(checkout, 'rack-types', 'example.yaml'),
    'slug: example-rack\nu_height: 12\n',
  );
  git('add', '.');
  git(
    '-c',
    'user.name=Test Author',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  const lock = { ref: git('rev-parse', 'HEAD'), source: 'example/catalogue' };
  const encoded = await generateFullCatalogue(checkout, lock);
  assert.equal(await generateFullCatalogue(checkout, lock), encoded);
  assert.equal(
    Buffer.from(encoded, 'base64')[9],
    0xff,
    'gzip OS byte must be normalized so encoding is identical across platforms',
  );
  const payload = JSON.parse(
    gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'),
  );
  assert.equal(payload.devices.example.uHeight, 1);
  assert.deepEqual(Object.keys(payload.devices), [
    'A',
    'B',
    '_x',
    'a',
    'another',
    'example',
    'z',
  ]);
  assert.equal(payload.racks['example-rack'].u_height, 12);
  const output = join(root, 'payload.b64');
  await writeFile(output, encoded);
  await verifyFullCatalogue(checkout, lock, output);
  await writeFile(output, `${encoded}\n`);
  await assert.rejects(verifyFullCatalogue(checkout, lock, output), /stale/);
  assert.equal(await readFile(output, 'utf8'), `${encoded}\n`);
  await assert.rejects(
    generateFullCatalogue(checkout, { ...lock, ref: '0'.repeat(40) }),
    /pinned upstream/,
  );
  await writeFile(devicePath, `${yaml}airflow: front-to-rear\n`);
  await assert.rejects(generateFullCatalogue(checkout, lock), /clean upstream/);
  await writeFile(devicePath, yaml);
  const extra = join(checkout, 'device-types', 'extra.yaml');
  await writeFile(extra, 'slug: extra\n');
  await assert.rejects(generateFullCatalogue(checkout, lock), /clean upstream/);
  await rm(extra);
  await writeFile(join(checkout, '.git', 'info', 'exclude'), 'ignored.yaml\n');
  await writeFile(join(checkout, 'ignored.yaml'), 'slug: ignored\n');
  await assert.rejects(generateFullCatalogue(checkout, lock), /clean upstream/);
});
