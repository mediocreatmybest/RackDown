import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { type SvgRenderOptions, toSvg } from './renderer.js';
import { resolve } from './resolver.js';

/** Matches a standalone stroke colour attribute, not stroke-width and friends. */
const STROKE_ATTRIBUTE = / stroke="/;
const RESOLVED_STROKE_ATTRIBUTE = / stroke="#[0-9a-f]{6}"/i;
const MONOCHROME_RULE =
  ':where(.rackdown-connection[data-colour-source="monochrome"]) { stroke: var(--rackdown-connection-stroke, #64748b); }';
const DEFAULT_WIDTH_RULE =
  ':where(.rackdown-connection.rackdown-connection-default-width) { stroke-width: var(--rackdown-connection-width, 2); }';
const DEFAULT_WIDTH_CLASS = 'rackdown-connection-default-width';

function rootId(svg: string): string {
  const match = svg.match(/<svg id="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('SVG is missing a root id');
  }
  return match[1];
}

function connectionTags(svg: string): string[] {
  return svg.match(/<(?:line|path) id="[^"]+-connection-[^"]+"[^>]*>/g) ?? [];
}

function connectionStyleRule(svg: string): string {
  const match = svg.match(
    /:where\(#[A-Za-z0-9_-]+\) \.rackdown-connection \{[^}]*\}/,
  );
  if (!match) {
    throw new Error('SVG is missing the .rackdown-connection style rule');
  }
  return match[0];
}

const SOURCE = `rack "Rack" 4U
4 switch "Core" as core
3 router "Gateway" as gateway
2 server "Node" as node
core:1 -- gateway:1
gateway:2 -- node:1
gateway:3 -- [[ISP Handover]]`;

describe('runtime SVG option safety', () => {
  const invalidValues = [
    '" onload="alert(1)',
    '"><script>alert(1)</script><g data-x="&',
    "' < > &",
    'unsupported',
    '',
    null,
    42,
    {},
  ];

  for (const key of [
    'externalPlacement',
    'connectionRouting',
    'connectionColourMode',
  ] as const) {
    it.each(invalidValues)(`${key} falls back safely for %j`, (value) => {
      const layout = resolve(parse(SOURCE));
      const options = { namespace: 'runtime-options', [key]: value };
      const svg = toSvg(layout, options as unknown as SvgRenderOptions);

      expect(svg).not.toMatch(/\sonload\s*=/i);
      expect(svg).not.toContain('<script>');
      expect(svg).toBe(toSvg(layout, { namespace: 'runtime-options' }));
    });
  }

  for (const adHoc of [false, true]) {
    for (const perConnection of [false, true]) {
      it.each(invalidValues)(
        `rejects pattern %j (adHoc=${adHoc}, perConnection=${perConnection})`,
        (pattern) => {
          const layout = resolve(parse(SOURCE));
          for (const connection of layout.connections) {
            for (const endpoint of [connection.from, connection.to]) {
              if (endpoint.kind === 'device') endpoint.adHocPort = adHoc;
            }
          }
          const options = {
            namespace: 'runtime-patterns',
            connectionStyle: { pattern: perConnection ? 'dotted' : pattern },
            ...(perConnection
              ? {
                  connectionStyles: Object.fromEntries(
                    layout.connections.map(({ id }) => [id, { pattern }]),
                  ),
                }
              : {}),
          };
          const svg = toSvg(layout, options as unknown as SvgRenderOptions);

          expect(svg).not.toMatch(/\sonload\s*=/i);
          expect(svg).not.toContain('<script>');
          expect(connectionTags(svg)).toHaveLength(3);
          expect(svg).toBe(toSvg(layout, { namespace: 'runtime-patterns' }));
          expect(connectionTags(svg)[0]).toContain(
            `data-pattern="${adHoc ? 'dashed' : 'solid'}"`,
          );
        },
      );
    }
  }

  it('preserves supported option values and deterministic output', () => {
    const layout = resolve(parse(SOURCE));
    for (const externalPlacement of ['bottom', 'right'] as const) {
      for (const connectionRouting of [
        'direct',
        'orthogonal',
        'lanes',
        'perimeter',
      ] as const) {
        for (const connectionColourMode of ['auto', 'monochrome'] as const) {
          for (const [pattern, dashArray] of [
            ['solid', 'none'],
            ['dashed', '6 4'],
            ['dotted', '1 4'],
          ] as const) {
            const options = {
              externalPlacement,
              connectionRouting,
              connectionColourMode,
              connectionStyle: { pattern },
            };
            const svg = toSvg(layout, options);
            expect(svg).toBe(toSvg(layout, options));
            expect(svg).toContain(
              `data-external-placement="${externalPlacement}"`,
            );
            expect(svg).toContain(
              `data-connection-routing="${connectionRouting}"`,
            );
            expect(svg).toContain(
              `data-connection-colour-mode="${connectionColourMode}"`,
            );
            for (const tag of connectionTags(svg)) {
              expect(tag).toContain(`data-pattern="${pattern}"`);
              expect(tag).toContain(`stroke-dasharray="${dashArray}"`);
            }
          }
        }
      }
    }
  });

  it('escapes legitimate author labels exactly once', () => {
    const layout = resolve(
      parse(SOURCE.replace('ISP Handover', `ISP "A" & <B> 'C'`)),
    );
    const svg = toSvg(layout);

    expect(svg).toContain(
      'data-label="ISP &quot;A&quot; &amp; &lt;B&gt; &apos;C&apos;"',
    );
    expect(svg).toContain(
      '<title>ISP &quot;A&quot; &amp; &lt;B&gt; &apos;C&apos;</title>',
    );
    expect(svg).not.toContain('&amp;quot;');
    expect(svg).not.toContain('&amp;amp;');
  });
});

describe('connection presentation styles', () => {
  it('renders deterministic automatic colours with rounded two-unit strokes by default', () => {
    const layout = resolve(parse(SOURCE));
    const first = toSvg(layout, { namespace: 'style-defaults' });
    const second = toSvg(layout, { namespace: 'style-defaults' });
    const tags = connectionTags(first);

    expect(first).toBe(second);
    expect(first).toContain('data-connection-colour-mode="auto"');
    expect(tags).toHaveLength(3);
    expect(tags.every((tag) => tag.includes('stroke-width="2"'))).toBe(true);
    expect(tags.every((tag) => tag.includes('stroke-linecap="round"'))).toBe(
      true,
    );
    expect(tags.every((tag) => tag.includes('stroke-linejoin="round"'))).toBe(
      true,
    );
    expect(tags.every((tag) => tag.includes('data-colour-source="auto"'))).toBe(
      true,
    );
    expect(tags.every((tag) => RESOLVED_STROKE_ATTRIBUTE.test(tag))).toBe(true);
  });

  it('supports a monochrome renderer mode without losing pattern information', () => {
    const svg = toSvg(resolve(parse(SOURCE)), {
      namespace: 'style-monochrome',
      connectionColourMode: 'monochrome',
      connectionStyle: { pattern: 'dotted' },
    });
    const tags = connectionTags(svg);

    expect(svg).toContain('data-connection-colour-mode="monochrome"');
    expect(tags).toHaveLength(3);
    expect(
      tags.every((tag) => tag.includes('data-colour-source="monochrome"')),
    ).toBe(true);
    expect(tags.every((tag) => tag.includes('data-pattern="dotted"'))).toBe(
      true,
    );
    expect(tags.every((tag) => tag.includes('stroke-dasharray="1 4"'))).toBe(
      true,
    );
    expect(tags.every((tag) => !tag.includes('style="stroke:'))).toBe(true);
    expect(tags.every((tag) => !STROKE_ATTRIBUTE.test(tag))).toBe(true);
  });

  it('lets explicit per-connection visual intent override automatic defaults', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[1];
    if (!connection) {
      throw new Error('Fixture is missing the second connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-explicit',
      connectionStyles: {
        [connection.id]: {
          color: '#ff00aa',
          pattern: 'dotted',
          width: 3.5,
          opacity: 0.4,
        },
      },
    });
    const tag = connectionTags(svg).find((candidate) =>
      candidate.includes(`data-connection-id="${connection.id}"`),
    );

    expect(tag).toBeDefined();
    expect(tag).toContain('data-colour-source="explicit"');
    expect(tag).toContain('data-pattern="dotted"');
    expect(tag).toContain('stroke-width="3.5"');
    expect(tag).toContain('stroke-opacity="0.4"');
    expect(tag).toContain('stroke-dasharray="1 4"');
    expect(tag).toContain(' stroke="#ff00aa"');
  });

  it('emits resolved colours as presentation attributes rather than inline style', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[0];
    if (!connection) {
      throw new Error('Fixture is missing a connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-no-inline',
      connectionStyles: { [connection.id]: { color: '#ff00aa' } },
    });
    const tags = connectionTags(svg);

    expect(tags).toHaveLength(3);
    expect(tags.every((tag) => !tag.includes('style="'))).toBe(true);
    expect(tags.every((tag) => RESOLVED_STROKE_ATTRIBUTE.test(tag))).toBe(true);
  });

  it('leaves connection colour to host CSS instead of an unconditional stylesheet stroke', () => {
    const svg = toSvg(resolve(parse(SOURCE)), {
      namespace: 'style-css-contract',
    });

    expect(connectionStyleRule(svg)).toContain('fill: none');
    expect(connectionStyleRule(svg)).not.toContain('stroke:');
    expect(svg).toContain(`:where(#${rootId(svg)}) ${MONOCHROME_RULE}`);
  });

  it('rejects unsafe explicit colours and falls back to the automatic palette', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[0];
    if (!connection) {
      throw new Error('Fixture is missing a connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-unsafe-colour',
      connectionStyles: { [connection.id]: { color: 'url(#x)' } },
    });
    const tag = connectionTags(svg).find((candidate) =>
      candidate.includes(`data-connection-id="${connection.id}"`),
    );

    expect(tag).toBeDefined();
    expect(tag).toContain('data-colour-source="auto"');
    expect(tag).toMatch(RESOLVED_STROKE_ATTRIBUTE);
    expect(tag).not.toContain('stroke="url(');
    expect(tag).not.toContain('url(#x');
  });

  it('represents solid, dashed and dotted patterns without SVG mechanics in the public contract', () => {
    const layout = resolve(parse(SOURCE));
    const patterns = ['solid', 'dashed', 'dotted'] as const;
    const connectionStyles = Object.fromEntries(
      layout.connections.map((connection, index) => [
        connection.id,
        { pattern: patterns[index % patterns.length] ?? 'solid' },
      ]),
    );
    const svg = toSvg(layout, {
      namespace: 'style-patterns',
      connectionColourMode: 'monochrome',
      connectionStyles,
    });
    const tags = connectionTags(svg);

    expect(tags[0]).toContain('data-pattern="solid"');
    expect(tags[0]).toContain('stroke-dasharray="none"');
    expect(tags[1]).toContain('data-pattern="dashed"');
    expect(tags[1]).toContain('stroke-dasharray="6 4"');
    expect(tags[2]).toContain('data-pattern="dotted"');
    expect(tags[2]).toContain('stroke-dasharray="1 4"');
  });

  it('normalizes invalid width and opacity values safely', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[0];
    if (!connection) {
      throw new Error('Fixture is missing a connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-normalized',
      connectionStyles: {
        [connection.id]: { width: -5, opacity: 4 },
      },
    });
    const tag = connectionTags(svg).find((candidate) =>
      candidate.includes(`data-connection-id="${connection.id}"`),
    );

    expect(tag).toContain('stroke-width="2"');
    expect(tag).toContain('stroke-opacity="1"');
  });

  it('includes style options in the derived namespace fingerprint', () => {
    const layout = resolve(parse(SOURCE));
    const automatic = toSvg(layout);
    const monochrome = toSvg(layout, { connectionColourMode: 'monochrome' });
    const dashed = toSvg(layout, { connectionStyle: { pattern: 'dashed' } });

    expect(rootId(automatic)).not.toBe(rootId(monochrome));
    expect(rootId(automatic)).not.toBe(rootId(dashed));
    expect(automatic).toBe(toSvg(layout));
    expect(monochrome).toBe(
      toSvg(layout, { connectionColourMode: 'monochrome' }),
    );
  });
  it('marks renderer-default widths so hosts can theme them without touching explicit intent', () => {
    const svg = toSvg(resolve(parse(SOURCE)), {
      namespace: 'style-default-width',
    });
    const tags = connectionTags(svg);

    expect(tags).toHaveLength(3);
    expect(tags.every((tag) => tag.includes(DEFAULT_WIDTH_CLASS))).toBe(true);
    expect(tags.every((tag) => tag.includes('stroke-width="2"'))).toBe(true);
    expect(svg).toContain(`:where(#${rootId(svg)}) ${DEFAULT_WIDTH_RULE}`);
  });

  it('keeps a global explicit width authoritative over the default-width rule', () => {
    const svg = toSvg(resolve(parse(SOURCE)), {
      namespace: 'style-global-width',
      connectionStyle: { width: 3.5 },
    });
    const tags = connectionTags(svg);

    expect(tags).toHaveLength(3);
    expect(tags.every((tag) => tag.includes('stroke-width="3.5"'))).toBe(true);
    expect(tags.some((tag) => tag.includes(DEFAULT_WIDTH_CLASS))).toBe(false);
  });

  it('keeps a per-connection explicit width authoritative and leaves siblings themeable', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[1];
    if (!connection) {
      throw new Error('Fixture is missing the second connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-per-connection-width',
      connectionStyles: { [connection.id]: { width: 3.5 } },
    });
    const tags = connectionTags(svg);
    const explicit = tags.find((candidate) =>
      candidate.includes(`data-connection-id="${connection.id}"`),
    );

    expect(explicit).toBeDefined();
    expect(explicit).toContain('stroke-width="3.5"');
    expect(explicit).not.toContain(DEFAULT_WIDTH_CLASS);
    expect(
      tags.filter((tag) => tag.includes(DEFAULT_WIDTH_CLASS)),
    ).toHaveLength(2);
  });

  it('treats an invalid explicit width as the themeable renderer default', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[0];
    if (!connection) {
      throw new Error('Fixture is missing a connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-invalid-width',
      connectionStyles: { [connection.id]: { width: 0 } },
    });
    const tag = connectionTags(svg).find((candidate) =>
      candidate.includes(`data-connection-id="${connection.id}"`),
    );

    expect(tag).toContain('stroke-width="2"');
    expect(tag).toContain(DEFAULT_WIDTH_CLASS);
  });

  it('introduces no inline style attributes while widths stay themeable', () => {
    const layout = resolve(parse(SOURCE));
    const connection = layout.connections[0];
    if (!connection) {
      throw new Error('Fixture is missing a connection');
    }

    const svg = toSvg(layout, {
      namespace: 'style-width-no-inline',
      connectionStyles: { [connection.id]: { width: 3 } },
    });
    const tags = connectionTags(svg);

    expect(svg).not.toContain(' style="');
    expect(tags.every((tag) => !tag.includes('style="'))).toBe(true);
    expect(
      tags.filter((tag) => tag.includes(DEFAULT_WIDTH_CLASS)),
    ).toHaveLength(2);
  });
});
