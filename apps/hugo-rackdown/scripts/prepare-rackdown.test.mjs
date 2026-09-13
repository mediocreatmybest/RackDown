import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  findRackDownBlocks,
  hashRackDownSource,
  prepareSite,
  renderBlockWithCli,
} from './prepare-rackdown.mjs';

function createTempSite(files = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hugo-rackdown-test-'));
  const contentDir = path.join(tmpDir, 'content');
  const outputDir = path.join(tmpDir, 'assets', 'rackdown-generated');
  fs.mkdirSync(contentDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return {
    tmpDir,
    contentDir,
    outputDir,
    cleanup() {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

test('1. one backtick RackDown fence is discovered', () => {
  const md = '```rackdown\nrack "Test" 12U\n```';
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].source, 'rack "Test" 12U');
});

test('2. one tilde RackDown fence is discovered', () => {
  const md = '~~~rackdown\nrack "Test" 12U\n~~~';
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].source, 'rack "Test" 12U');
});

test('3. an unrelated code fence is ignored', () => {
  const md = '```javascript\nconsole.log("hello");\n```\n~~~text\nhello\n~~~';
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 0);
});

test('4. rackdownish is not treated as RackDown', () => {
  const md = '```rackdownish\nrack "Test" 12U\n```';
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 0);
});

test('5. optional tokens/attributes after the rackdown info token do not prevent discovery', () => {
  const md = '```rackdown title="My Rack" class="wide"\nrack "Test" 12U\n```';
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].source, 'rack "Test" 12U');
});

test('6. opening line number is retained', () => {
  const md = '# Title\n\nParagraph\n\n```rackdown\nrack "Test" 12U\n```';
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].line, 5);
});

test('7. multiple RackDown blocks are discovered in source order', () => {
  const md = [
    '```rackdown',
    'rack "One" 8U',
    '```',
    'Between text',
    '```rackdown',
    'rack "Two" 12U',
    '```',
    '~~~rackdown',
    'rack "Three" 24U',
    '~~~',
  ].join('\n');
  const blocks = findRackDownBlocks(md);
  assert.strictEqual(blocks.length, 3);
  assert.strictEqual(blocks[0].line, 1);
  assert.strictEqual(blocks[0].source, 'rack "One" 8U');
  assert.strictEqual(blocks[1].line, 5);
  assert.strictEqual(blocks[1].source, 'rack "Two" 12U');
  assert.strictEqual(blocks[2].line, 8);
  assert.strictEqual(blocks[2].source, 'rack "Three" 24U');
});

test('8. identical RackDown source produces identical SHA-256', () => {
  const src = 'rack "Test" 12U\n12 switch "Core"';
  const hash1 = hashRackDownSource(src);
  const hash2 = hashRackDownSource(src);
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64);
});

test('9. different RackDown source produces a different SHA-256', () => {
  const src1 = 'rack "Test" 12U\n12 switch "Core"';
  const src2 = 'rack "Test" 12U\n12 switch "Distribution"';
  assert.notStrictEqual(hashRackDownSource(src1), hashRackDownSource(src2));
});

test('10. duplicate identical blocks render only once', () => {
  const site = createTempSite({
    'content/page1.md': '```rackdown\nrack "Shared" 12U\n```',
    'content/page2.md': '```rackdown\nrack "Shared" 12U\n```',
  });
  try {
    let renderCount = 0;
    const mockRenderer = () => {
      renderCount++;
      return '<svg>mock</svg>';
    };
    const result = prepareSite({
      siteDir: site.tmpDir,
      contentDir: site.contentDir,
      outputDir: site.outputDir,
      renderer: mockRenderer,
    });
    assert.strictEqual(result.totalBlocks, 2);
    assert.strictEqual(result.uniqueBlocks, 1);
    assert.strictEqual(renderCount, 1);
  } finally {
    site.cleanup();
  }
});

test('11. generated asset names are deterministic', () => {
  const src = 'rack "Test" 12U';
  const expectedHash = hashRackDownSource(src);
  const site = createTempSite({
    'content/page.md': `\`\`\`rackdown\n${src}\n\`\`\``,
  });
  try {
    const result = prepareSite({
      siteDir: site.tmpDir,
      contentDir: site.contentDir,
      outputDir: site.outputDir,
      renderer: () => '<svg>test</svg>',
    });
    assert.strictEqual(result.generatedAssets.length, 1);
    assert.strictEqual(
      path.basename(result.generatedAssets[0]),
      `${expectedHash}.svg`,
    );
  } finally {
    site.cleanup();
  }
});

test('12. stale generated assets are removed during a complete preparation', () => {
  const site = createTempSite({
    'content/page.md': '```rackdown\nrack "Current" 12U\n```',
    'assets/rackdown-generated/stale-hash.svg': '<svg>stale</svg>',
  });
  try {
    const staleFile = path.join(site.outputDir, 'stale-hash.svg');
    assert.strictEqual(fs.existsSync(staleFile), true);

    prepareSite({
      siteDir: site.tmpDir,
      contentDir: site.contentDir,
      outputDir: site.outputDir,
      renderer: () => '<svg>current</svg>',
    });

    assert.strictEqual(fs.existsSync(staleFile), false);
  } finally {
    site.cleanup();
  }
});

test('13. an unterminated RackDown fence fails clearly', () => {
  const md = '# Section\n\n```rackdown\nrack "Broken" 12U';
  assert.throws(
    () => findRackDownBlocks(md, 'content/test.md'),
    /Unterminated RackDown fence in content\/test\.md:3/,
  );
});

test('14. renderBlockWithCli relays successful CLI warnings with occurrence context', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rackdown-warning-test-'),
  );
  const fakeCliPath = path.join(tmpDir, 'fake-cli.mjs');
  const fakeSvg = '<svg id="warning-test"></svg>';
  const fakeWarning = '<stdin>:1: warn: Test warning\n';
  fs.writeFileSync(
    fakeCliPath,
    `process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write(${JSON.stringify(fakeWarning)});
  process.stdout.write(${JSON.stringify(fakeSvg)});
});
`,
    'utf-8',
  );

  let capturedStderr = '';
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = (chunk, encoding, callback) => {
    capturedStderr +=
      typeof chunk === 'string' ? chunk : chunk.toString(encoding);
    if (typeof callback === 'function') callback();
    return true;
  };

  try {
    const resultSvg = renderBlockWithCli('rack "Warning" 12U', {
      cliPath: fakeCliPath,
      occurrences: [{ file: 'content/page.md', line: 5 }],
    });

    assert.strictEqual(resultSvg, fakeSvg);
    assert.ok(
      capturedStderr.includes(fakeWarning),
      `Expected stderr to contain warning text: ${capturedStderr}`,
    );
    assert.ok(
      capturedStderr.includes('content/page.md:5'),
      `Expected stderr to contain occurrence context: ${capturedStderr}`,
    );
  } finally {
    process.stderr.write = originalStderrWrite;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('15. simulated CLI exit 1 fails preparation', () => {
  const site = createTempSite({
    'content/page.md': '```rackdown\nrack "Error" 12.5U\n```',
  });
  try {
    const mockRenderer = () => {
      const err = new Error('RackDown error in content/page.md:1: Exit code 1');
      err.status = 1;
      throw err;
    };
    assert.throws(
      () =>
        prepareSite({
          siteDir: site.tmpDir,
          contentDir: site.contentDir,
          outputDir: site.outputDir,
          renderer: mockRenderer,
        }),
      /Exit code 1/,
    );
  } finally {
    site.cleanup();
  }
});

test('16. simulated CLI exit 2 fails preparation', () => {
  const site = createTempSite({
    'content/page.md': '```rackdown\nrack "RuntimeError" 12U\n```',
  });
  try {
    const mockRenderer = () => {
      const err = new Error('RackDown CLI usage/runtime error (exit code 2)');
      err.status = 2;
      throw err;
    };
    assert.throws(
      () =>
        prepareSite({
          siteDir: site.tmpDir,
          contentDir: site.contentDir,
          outputDir: site.outputDir,
          renderer: mockRenderer,
        }),
      /exit code 2/,
    );
  } finally {
    site.cleanup();
  }
});

test('17. failed rendering does not leave a generated SVG for that block', () => {
  const src = 'rack "Failing" 12U';
  const failingHash = hashRackDownSource(src);
  const site = createTempSite({
    'content/page.md': `\`\`\`rackdown\n${src}\n\`\`\``,
    [`assets/rackdown-generated/${failingHash}.svg`]: '<svg>old</svg>',
  });
  try {
    const mockRenderer = () => {
      throw new Error('Simulation failed');
    };
    assert.throws(() =>
      prepareSite({
        siteDir: site.tmpDir,
        contentDir: site.contentDir,
        outputDir: site.outputDir,
        renderer: mockRenderer,
      }),
    );
    const assetFile = path.join(site.outputDir, `${failingHash}.svg`);
    assert.strictEqual(fs.existsSync(assetFile), false);
  } finally {
    site.cleanup();
  }
});

test('18. source Markdown is never modified', () => {
  const originalMd = '# Title\n\n```rackdown\nrack "Test" 12U\n```\n';
  const site = createTempSite({
    'content/page.md': originalMd,
  });
  try {
    prepareSite({
      siteDir: site.tmpDir,
      contentDir: site.contentDir,
      outputDir: site.outputDir,
      renderer: () => '<svg>result</svg>',
    });
    const afterMd = fs.readFileSync(
      path.join(site.contentDir, 'page.md'),
      'utf-8',
    );
    assert.strictEqual(afterMd, originalMd);
  } finally {
    site.cleanup();
  }
});

test('19. generated SVG uses the exact renderer output supplied by the renderer boundary', () => {
  const customSvg =
    '<svg id="custom-output" xmlns="http://www.w3.org/2000/svg"></svg>';
  const src = 'rack "Test" 12U';
  const hash = hashRackDownSource(src);
  const site = createTempSite({
    'content/page.md': `\`\`\`rackdown\n${src}\n\`\`\``,
  });
  try {
    prepareSite({
      siteDir: site.tmpDir,
      contentDir: site.contentDir,
      outputDir: site.outputDir,
      renderer: () => customSvg,
    });
    const savedSvg = fs.readFileSync(
      path.join(site.outputDir, `${hash}.svg`),
      'utf-8',
    );
    assert.strictEqual(savedSvg, customSvg);
  } finally {
    site.cleanup();
  }
});

test('20. file ordering does not affect deterministic output', () => {
  const site1 = createTempSite({
    'content/a.md': '```rackdown\nrack "A" 12U\n```',
    'content/b.md': '```rackdown\nrack "B" 12U\n```',
  });
  const site2 = createTempSite({
    'content/b.md': '```rackdown\nrack "B" 12U\n```',
    'content/a.md': '```rackdown\nrack "A" 12U\n```',
  });
  try {
    prepareSite({
      siteDir: site1.tmpDir,
      contentDir: site1.contentDir,
      outputDir: site1.outputDir,
      renderer: (source) => `<svg>${source}</svg>`,
    });
    prepareSite({
      siteDir: site2.tmpDir,
      contentDir: site2.contentDir,
      outputDir: site2.outputDir,
      renderer: (source) => `<svg>${source}</svg>`,
    });

    const files1 = fs.readdirSync(site1.outputDir).sort();
    const files2 = fs.readdirSync(site2.outputDir).sort();
    assert.deepStrictEqual(files1, files2);

    for (const file of files1) {
      const content1 = fs.readFileSync(
        path.join(site1.outputDir, file),
        'utf-8',
      );
      const content2 = fs.readFileSync(
        path.join(site2.outputDir, file),
        'utf-8',
      );
      assert.strictEqual(content1, content2);
    }
  } finally {
    site1.cleanup();
    site2.cleanup();
  }
});
