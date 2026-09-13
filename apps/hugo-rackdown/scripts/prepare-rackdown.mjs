import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Discovers fenced RackDown code blocks in a Markdown string.
 *
 * @param {string} markdown
 * @param {string} [filePath='<input>']
 * @returns {Array<{ file: string, line: number, source: string }>}
 */
export function findRackDownBlocks(markdown, filePath = '<input>') {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let state = 'OUTSIDE';
  let fenceChar = null;
  let fenceLength = 0;
  let fenceIndent = 0;
  let openingLine = 0;
  let bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (state === 'OUTSIDE') {
      const match = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/);
      if (match) {
        const indent = match[1].length;
        const fChar = match[2][0];
        const fLen = match[2].length;
        const info = match[3];

        if (fChar === '`' && info.includes('`')) {
          continue;
        }

        const trimmedInfo = info.trim();
        const firstToken =
          trimmedInfo.length > 0 ? trimmedInfo.split(/[ \t]+/)[0] : '';

        if (firstToken === 'rackdown') {
          state = 'IN_RACKDOWN';
          fenceChar = fChar;
          fenceLength = fLen;
          fenceIndent = indent;
          openingLine = lineNumber;
          bodyLines = [];
        } else {
          state = 'IN_OTHER_FENCE';
          fenceChar = fChar;
          fenceLength = fLen;
        }
      }
    } else if (state === 'IN_OTHER_FENCE') {
      const match = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
      if (match) {
        const cChar = match[2][0];
        const cLen = match[2].length;
        if (cChar === fenceChar && cLen >= fenceLength) {
          state = 'OUTSIDE';
        }
      }
    } else if (state === 'IN_RACKDOWN') {
      const match = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
      if (match) {
        const cChar = match[2][0];
        const cLen = match[2].length;
        if (cChar === fenceChar && cLen >= fenceLength) {
          state = 'OUTSIDE';
          blocks.push({
            file: filePath,
            line: openingLine,
            source: bodyLines.join('\n'),
          });
          bodyLines = [];
          continue;
        }
      }

      let contentLine = line;
      if (fenceIndent > 0) {
        contentLine = line.replace(new RegExp(`^ {1,${fenceIndent}}`), '');
      }
      bodyLines.push(contentLine);
    }
  }

  if (state === 'IN_RACKDOWN') {
    throw new Error(
      `Unterminated RackDown fence in ${filePath}:${openingLine}`,
    );
  }

  return blocks;
}

/**
 * Calculates a deterministic SHA-256 hash for RackDown source.
 * Normalizes CRLF/CR to LF so line-ending variations produce identical hashes.
 *
 * @param {string} source
 * @returns {string} 64-character lowercase hex string
 */
export function hashRackDownSource(source) {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/**
 * Recursively locates all Markdown files below a directory.
 * Returns sorted relative or absolute paths for determinism.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function collectMarkdownFiles(dir) {
  const files = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))
      ) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files.sort();
}

/**
 * Invokes the RackDown CLI to render a block of RackDown source to SVG.
 *
 * @param {string} source
 * @param {object} options
 * @param {string} options.cliPath
 * @param {Array<{ file: string, line: number }>} [options.occurrences=[]]
 * @returns {string} SVG string
 */
export function renderBlockWithCli(source, { cliPath, occurrences = [] }) {
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `RackDown CLI binary not found at ${cliPath}. Please build it first with: pnpm --filter @rackdown/cli build`,
    );
  }

  const result = spawnSync(
    process.execPath,
    [cliPath, 'render', '-', '--sizing', 'responsive'],
    {
      input: source,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw new Error(`Failed to execute RackDown CLI: ${result.error.message}`);
  }

  const context = occurrences.map((o) => `${o.file}:${o.line}`).join(', ');

  if (result.status === 0) {
    if (result.stderr && result.stderr.trim().length > 0) {
      process.stderr.write(
        `[rackdown] Note/warning in ${context}:\n${result.stderr}\n`,
      );
    }
    return result.stdout;
  }

  if (result.status === 1) {
    throw new Error(
      `RackDown error in ${context}:\n${result.stderr || 'Exit code 1'}`,
    );
  }

  if (result.status === 2) {
    throw new Error(
      `RackDown CLI usage/runtime error (exit code ${result.status}) in ${context}:\n${result.stderr || 'Exit code 2'}`,
    );
  }

  throw new Error(
    `RackDown CLI failed (exit code ${result.status}) in ${context}:\n${result.stderr}`,
  );
}

/**
 * Prepares RackDown assets for a Hugo site.
 *
 * @param {object} [options={}]
 * @param {string} [options.siteDir]
 * @param {string} [options.contentDir]
 * @param {string} [options.outputDir]
 * @param {string} [options.cliPath]
 * @param {function} [options.renderer]
 * @returns {{ totalBlocks: number, uniqueBlocks: number, generatedAssets: string[] }}
 */
export function prepareSite(options = {}) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const siteDir = options.siteDir || path.resolve(currentDir, '..');
  const contentDir = options.contentDir || path.join(siteDir, 'content');
  const outputDir =
    options.outputDir || path.join(siteDir, 'assets', 'rackdown-generated');
  const cliPath =
    options.cliPath ||
    path.resolve(siteDir, '../../packages/rackdown-cli/dist/cli.mjs');
  const renderer = options.renderer || renderBlockWithCli;

  // 1. Locate all Markdown files
  const mdFiles = collectMarkdownFiles(contentDir);

  // 2. Discover all RackDown blocks
  const allBlocks = [];
  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(siteDir, filePath);
    const blocks = findRackDownBlocks(content, relPath);
    allBlocks.push(...blocks);
  }

  // 3. Deduplicate by SHA-256 hash
  const uniqueBlocks = new Map();
  for (const block of allBlocks) {
    const hash = hashRackDownSource(block.source);
    if (!uniqueBlocks.has(hash)) {
      uniqueBlocks.set(hash, {
        source: block.source,
        occurrences: [],
      });
    }
    uniqueBlocks
      .get(hash)
      .occurrences.push({ file: block.file, line: block.line });
  }

  // 4. Remove stale generated assets
  fs.mkdirSync(outputDir, { recursive: true });
  const existingFiles = fs.readdirSync(outputDir);
  for (const file of existingFiles) {
    if (file.endsWith('.svg')) {
      const fileHash = path.basename(file, '.svg');
      if (!uniqueBlocks.has(fileHash)) {
        fs.unlinkSync(path.join(outputDir, file));
      }
    }
  }

  // 5. Render unique blocks deterministically (sorted by hash)
  const sortedHashes = Array.from(uniqueBlocks.keys()).sort();
  const generatedAssets = [];

  for (const hash of sortedHashes) {
    const info = uniqueBlocks.get(hash);
    const targetFile = path.join(outputDir, `${hash}.svg`);
    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
    }
    const svg = renderer(info.source, {
      hash,
      occurrences: info.occurrences,
      cliPath,
    });

    fs.writeFileSync(targetFile, svg, 'utf-8');
    generatedAssets.push(targetFile);
  }

  return {
    totalBlocks: allBlocks.length,
    uniqueBlocks: uniqueBlocks.size,
    generatedAssets,
  };
}

// CLI entry point
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = prepareSite();
    console.log(
      `Prepared ${result.uniqueBlocks} RackDown diagram(s) (${result.totalBlocks} block(s) total).`,
    );
  } catch (error) {
    console.error(`[prepare:rackdown] Error: ${error.message}`);
    process.exit(1);
  }
}
