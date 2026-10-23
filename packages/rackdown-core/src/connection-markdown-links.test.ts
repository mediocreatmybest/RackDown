import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const source = 'rack "Docs" 2U\n1 device "Core" as core\n';

describe('Markdown connection destinations', () => {
  it.each([
    'https://example.com/docs',
    'https://example.com/A_(B)',
    'https://example.com/A_(B_(C))_(D)',
    'https://example.com/A_(B--C)--D',
    String.raw`https://example.com/A\)--B`,
    String.raw`https://example.com/A\(B\)--C`,
    String.raw`https://example.com/A_(B\\)--C`,
    String.raw`https://example.com/A\\\)--B`,
    String.raw`../Notes\Archive_(B).md#Ports`,
  ])('preserves %s on either side without inventing metadata', (target) => {
    const link = `[Docs -- Guide](${target})`;
    for (const externalFirst of [false, true]) {
      const line = externalFirst ? `${link} -- core:1` : `core:1 -- ${link}`;
      const document = parse(source + line);
      expect(document.connections).toHaveLength(1);
      const connection = document.connections[0];
      expect(externalFirst ? connection?.from : connection?.to).toEqual({
        kind: 'external',
        label: 'Docs -- Guide',
        link: { style: 'markdown', target },
      });
      expect(connection).not.toHaveProperty('media');
      expect(connection).not.toHaveProperty('category');
      expect(document.diagnostics).toEqual([]);
      expect(parse(source + line)).toEqual(document);
    }
  });

  it.each([
    [' fibre', 'fibre', undefined],
    [' category network', undefined, 'network'],
    [' fibre category console', 'fibre', 'console'],
  ])(
    'starts trailing tokens after the real delimiter: %s',
    (trailing, media, category) => {
      const document = parse(
        `${source}core:1 -- [Docs](https://example.com/A_(B))${trailing}`,
      );
      expect(document.connections).toHaveLength(1);
      expect(document.connections[0]?.to).toMatchObject({
        link: { target: 'https://example.com/A_(B)' },
      });
      expect(document.connections[0]?.media).toBe(media);
      expect(document.connections[0]?.category).toBe(category);
      expect(document.diagnostics).toEqual([]);
    },
  );

  it('keeps source spans and trailing diagnostic columns after nested links', () => {
    const line =
      '  core:1 --   [Docs](https://example.com/A_(B)) fibre category wrong';
    const document = parse(source + line);
    expect(document.connections[0]?.source).toEqual({
      start: { line: 3, column: 3 },
      end: { line: 3, column: line.length + 1 },
    });
    expect(document.connections[0]?.media).toBe('fibre');
    expect(document.connections[0]?.category).toBe('invalid');
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: line.indexOf('wrong') + 1,
        message:
          'Missing or unknown connection category; preserving connection as unclassified.',
      },
    ]);
  });

  it('recognises exactly one operator between two protected Markdown endpoints', () => {
    const document = parse(
      `${source}[Source](https://example.com/A_(B)--C) -- [Target](https://example.com/D_(E)--F) fibre category network`,
    );
    expect(document.connections).toHaveLength(1);
    expect(document.connections[0]?.from).toMatchObject({
      link: { target: 'https://example.com/A_(B)--C' },
    });
    expect(document.connections[0]?.to).toMatchObject({
      link: { target: 'https://example.com/D_(E)--F' },
    });
    expect(document.connections[0]?.media).toBe('fibre');
    expect(document.connections[0]?.category).toBe('network');
    expect(document.diagnostics).toEqual([]);
  });

  it('still rejects a second operator outside a nested link and recovers the next line', () => {
    const line =
      '  core:1 -- [Docs](https://example.com/A_(B)--C) -- external "WAN -- Main"';
    const document = parse(`${source}${line}\ncore:1 -- [[Notes]]`);
    expect(document.connections).toHaveLength(1);
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: line.indexOf('--') + 1,
        message:
          'Connection contains more than one `--` operator; ignoring it.',
        hint: 'Use exactly one `--` between two endpoints.',
      },
    ]);
  });

  it.each([
    '[Docs]',
    '[Docs](',
    '[Docs](https://example.com/A_(B)',
    '[Docs](https://example.com/A_(B) fibre category network',
    String.raw`[Docs](https://example.com/A\)`,
    '[Docs](https://example.com/A_(B)))',
  ])(
    'rejects malformed destination %s at the endpoint column and recovers',
    (link) => {
      const line = `  core:1 --   ${link}`;
      const document = parse(`${source}${line}\ncore:1 -- [[Notes]]`);
      expect(document.connections).toHaveLength(1);
      expect(document.connections[0]?.id).toBe('connection-4');
      expect(document.diagnostics).toEqual([
        {
          severity: 'warn',
          line: 3,
          column: line.indexOf('[') + 1,
          message: 'Malformed Markdown link syntax; ignoring it.',
        },
      ]);
    },
  );

  it('does not guess an operator inside an unterminated source destination', () => {
    const document = parse(
      `${source}[Docs](https://example.com/A_(B)--C -- core:1`,
    );
    expect(document.connections).toEqual([]);
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        message: 'Connection has no structural `--` operator; ignoring it.',
      },
    ]);
  });

  it.each([
    ['[](https://example.com/A_(B))', 'label'],
    ['[   ](https://example.com/A_(B))', 'label'],
    ['[Docs]()', 'target'],
    ['[Docs](   )', 'target'],
  ])('retains empty %s diagnostics', (link, field) => {
    const line = `  core:1 --   ${link}`;
    const document = parse(source + line);
    expect(document.connections).toEqual([]);
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: line.indexOf('[') + 1,
        message: `Markdown link ${field} is empty; ignoring it.`,
      },
    ]);
  });

  it.each([
    'core:"port--(backup)"',
    '[[Notes_(B)--C|Wiki -- Notes]]',
    'external "WAN -- (Primary)"',
  ])(
    'preserves other protected endpoint forms alongside Markdown: %s',
    (endpoint) => {
      const document = parse(
        `${source}${endpoint} -- [Docs](https://example.com/A_(B)--C) fibre`,
      );
      const reference = parse(
        `${source}${endpoint} -- [Docs](https://example.com/simple) fibre`,
      );
      expect(document.connections).toHaveLength(1);
      expect(document.connections[0]?.from).toEqual(
        reference.connections[0]?.from,
      );
      expect(document.connections[0]?.to).toMatchObject({
        link: { target: 'https://example.com/A_(B)--C' },
      });
      expect(document.connections[0]?.media).toBe('fibre');
      expect(document.connections[0]).not.toHaveProperty('category');
      expect(document.diagnostics).toEqual([]);
    },
  );

  it('handles deep balanced destinations without recursion', () => {
    const target = `https://example.com/${'('.repeat(1000)}B${')'.repeat(1000)}`;
    const document = parse(`${source}core:1 -- [Docs](${target})`);
    expect(document.connections[0]?.to).toMatchObject({ link: { target } });
    expect(document.connections[0]).not.toHaveProperty('media');
    expect(document.diagnostics).toEqual([]);
  });

  it.each([
    'https://example.com/A_(B)--C?x=1&y=2',
    String.raw`https://example.com/A\)--B`,
  ])(
    'preserves host link metadata and deterministic SVG output for %s',
    (target) => {
      const input = `${source}core:1 -- [Docs](${target})`;
      const layout = resolve(parse(input));
      expect(layout.diagnostics).toEqual([]);
      expect(layout.connections).toHaveLength(1);
      expect(layout.connections[0]?.category).toBe('unclassified');
      expect(layout.connections[0]).not.toHaveProperty('media');
      expect(layout.externals[0]).toMatchObject({
        label: 'Docs',
        link: { style: 'markdown', target },
      });
      const svg = toSvg(layout, { namespace: 'markdown-links' });
      expect(svg).toContain('data-link-style="markdown"');
      expect(svg).toContain('data-label="Docs"');
      expect(svg).toContain(`data-target="${target.replaceAll('&', '&amp;')}"`);
      expect(
        toSvg(resolve(parse(input)), { namespace: 'markdown-links' }),
      ).toBe(svg);
    },
  );
});
