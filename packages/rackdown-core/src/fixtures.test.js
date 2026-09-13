import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, '..', '..', '..', 'fixtures');

function fixturePaths(group) {
  const directory = join(fixturesRoot, group);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.rackdown'))
    .sort()
    .map((name) => ({ name, path: join(directory, name) }));
}

for (const group of ['valid', 'broken']) {
  describe(`${group} fixture corpus`, () => {
    for (const fixture of fixturePaths(group)) {
      it(`${fixture.name} survives the full pipeline deterministically`, () => {
        const source = readFileSync(fixture.path, 'utf8');

        const firstLayout = resolve(parse(source));
        const secondLayout = resolve(parse(source));
        const firstSvg = toSvg(firstLayout, { namespace: 'fixture' });
        const secondSvg = toSvg(secondLayout, { namespace: 'fixture' });

        expect(firstLayout.schemaVersion).toBe(1);
        expect(firstLayout.diagnostics).toEqual(secondLayout.diagnostics);
        expect(firstSvg).toBe(secondSvg);
        expect(firstSvg).toContain('<svg');

        if (group === 'valid') {
          expect(firstLayout.diagnostics).not.toContainEqual(
            expect.objectContaining({ severity: 'error' }),
          );
        }
      });
    }
  });
}
