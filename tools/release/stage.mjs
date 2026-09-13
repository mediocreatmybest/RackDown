// Stage the artefacts a future tagged RackDown release would publish.
//
//   node tools/release/stage.mjs [--out <directory>]
//
// This only collects and verifies build output that already exists; it never
// publishes anything. Run the workspace build first (see package.json
// "release:rehearse"). The staged layout is deterministic so a rehearsal run
// can be inspected and compared between platforms.

import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const rackdownRoot = resolve(toolDirectory, '../..');

// The Obsidian community-plugin distribution must contain exactly these files.
const OBSIDIAN_DIST_FILES = ['main.js', 'manifest.json', 'styles.css'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requireDirectory(path, hint) {
  try {
    if (statSync(path).isDirectory()) return;
  } catch {
    // fall through to the shared error below
  }
  throw new Error(`Missing ${relative(rackdownRoot, path)}. ${hint}`);
}

function requireFile(path, hint) {
  try {
    if (statSync(path).isFile()) return;
  } catch {
    // fall through to the shared error below
  }
  throw new Error(`Missing ${relative(rackdownRoot, path)}. ${hint}`);
}

function verifyObsidianDistribution() {
  const distribution = resolve(rackdownRoot, 'packages/obsidian-rackdown/dist');
  requireDirectory(
    distribution,
    'Run "pnpm --filter obsidian-rackdown build" first.',
  );

  const actual = readdirSync(distribution).sort();
  const expected = [...OBSIDIAN_DIST_FILES].sort();

  if (actual.join('\n') !== expected.join('\n')) {
    throw new Error(
      `Obsidian distribution must contain exactly ${expected.join(', ')} but contains ${actual.join(', ') || '(nothing)'}.`,
    );
  }

  return distribution;
}

function copyPackage(packageDirectory, stagingRoot) {
  const source = resolve(rackdownRoot, packageDirectory);
  const manifest = readJson(resolve(source, 'package.json'));
  const target = resolve(
    stagingRoot,
    'packages',
    manifest.name.replace('@', '').replace('/', '-'),
  );

  mkdirSync(target, { recursive: true });
  cpSync(resolve(source, 'package.json'), resolve(target, 'package.json'));

  // Ship exactly what the package manifest declares in "files", which is what
  // an eventual npm publication would include.
  for (const entry of manifest.files ?? []) {
    const entrySource = resolve(source, entry);
    try {
      statSync(entrySource);
    } catch {
      throw new Error(
        `${manifest.name} declares "${entry}" in package.json "files" but it does not exist. Build the package first.`,
      );
    }
    cpSync(entrySource, resolve(target, entry), { recursive: true });
  }

  for (const optional of ['README.md', 'LICENSE']) {
    try {
      cpSync(resolve(source, optional), resolve(target, optional));
    } catch {
      // Optional package-local files.
    }
  }

  return { name: manifest.name, version: manifest.version, target };
}

function listFiles(root) {
  const files = [];

  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(root, path).split(sep).join(posix.sep));
    }
  };

  walk(root);
  return files.sort();
}

try {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const stagingRoot = resolve(
    rackdownRoot,
    outIndex === -1
      ? 'release-staging'
      : (args[outIndex + 1] ?? 'release-staging'),
  );

  const workspace = readJson(resolve(rackdownRoot, 'package.json'));

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  // 1. Obsidian adapter distribution, in the folder shape a vault expects.
  const obsidianDistribution = verifyObsidianDistribution();
  const obsidianTarget = resolve(stagingRoot, 'obsidian-plugin/rackdown');
  mkdirSync(obsidianTarget, { recursive: true });
  for (const file of OBSIDIAN_DIST_FILES) {
    cpSync(resolve(obsidianDistribution, file), resolve(obsidianTarget, file));
  }
  const obsidianManifest = readJson(resolve(obsidianTarget, 'manifest.json'));

  // 2. Publishable package payloads.
  const packages = [
    copyPackage('packages/rackdown-core', stagingRoot),
    copyPackage('packages/rackdown-devices', stagingRoot),
    copyPackage('packages/rackdown-cli', stagingRoot),
  ];

  requireFile(
    resolve(stagingRoot, 'packages/rackdown-cli/dist/cli.mjs'),
    'Run "pnpm --filter @rackdown/cli build" first.',
  );

  // 3. Example sources and any committed generated renders.
  const examplesTarget = resolve(stagingRoot, 'examples');
  mkdirSync(examplesTarget, { recursive: true });
  for (const entry of readdirSync(resolve(rackdownRoot, 'examples'), {
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name.endsWith('.rackdown')) {
      cpSync(
        resolve(rackdownRoot, 'examples', entry.name),
        resolve(examplesTarget, entry.name),
      );
    }
  }
  const generatedSource = resolve(rackdownRoot, 'examples/generated');
  try {
    for (const entry of readdirSync(generatedSource, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.svg')) {
        mkdirSync(resolve(examplesTarget, 'generated'), { recursive: true });
        cpSync(
          resolve(generatedSource, entry.name),
          resolve(examplesTarget, 'generated', entry.name),
        );
      }
    }
  } catch {
    // No committed generated renders yet.
  }

  // 4. Licence and upstream provenance travel with the release.
  cpSync(resolve(rackdownRoot, 'LICENSE'), resolve(stagingRoot, 'LICENSE'));
  const provenanceTarget = resolve(stagingRoot, 'provenance');
  mkdirSync(provenanceTarget, { recursive: true });
  cpSync(
    resolve(rackdownRoot, 'upstream/netbox.lock.json'),
    resolve(provenanceTarget, 'netbox.lock.json'),
  );
  cpSync(
    resolve(rackdownRoot, 'upstream/netbox/LICENSE.txt'),
    resolve(provenanceTarget, 'netbox-LICENSE.txt'),
  );
  const upstreamLock = readJson(resolve(provenanceTarget, 'netbox.lock.json'));

  // 5. A manifest describing exactly what was staged.
  const manifest = {
    workspaceVersion: workspace.version,
    obsidianPlugin: {
      id: obsidianManifest.id,
      version: obsidianManifest.version,
      minAppVersion: obsidianManifest.minAppVersion,
      files: OBSIDIAN_DIST_FILES,
    },
    packages: packages.map(({ name, version }) => ({ name, version })),
    upstreamCatalogue: {
      source: upstreamLock.source,
      ref: upstreamLock.ref,
    },
    files: [],
  };
  writeFileSync(
    resolve(stagingRoot, 'MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  manifest.files = listFiles(stagingRoot);
  writeFileSync(
    resolve(stagingRoot, 'MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `Staged release artefacts in ${relative(rackdownRoot, stagingRoot)}:`,
  );
  for (const file of manifest.files) console.log(`  ${file}`);
  console.log('');
  console.log(`Workspace version: ${manifest.workspaceVersion}`);
  for (const entry of manifest.packages) {
    console.log(`  ${entry.name}@${entry.version}`);
  }
  console.log(
    `  obsidian plugin ${manifest.obsidianPlugin.id}@${manifest.obsidianPlugin.version}`,
  );
  console.log(
    `  catalogue pin ${manifest.upstreamCatalogue.source}@${manifest.upstreamCatalogue.ref}`,
  );
  console.log('');
  console.log('Nothing was published. This is a staging/rehearsal step only.');
} catch (error) {
  console.error(
    `Release staging failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
