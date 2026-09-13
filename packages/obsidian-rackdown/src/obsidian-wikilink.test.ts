import { describe, expect, it } from 'vitest';
import { parseObsidianWikiLink } from './obsidian-wikilink.js';

describe('parseObsidianWikiLink', () => {
  it('leaves ordinary device labels alone', () => {
    expect(parseObsidianWikiLink('Core')).toBeUndefined();
    expect(parseObsidianWikiLink('switch [[sw2222]]')).toBeUndefined();
  });

  it('parses a whole-label wikilink', () => {
    expect(parseObsidianWikiLink('[[sw2222]]')).toEqual({
      target: 'sw2222',
      display: 'sw2222',
    });
  });

  it('supports a path with an explicit display label', () => {
    expect(
      parseObsidianWikiLink('[[Switches/sw2222|Access Switch 22]]'),
    ).toEqual({
      target: 'Switches/sw2222',
      display: 'Access Switch 22',
    });
  });

  it('rejects empty or malformed whole-label links', () => {
    expect(parseObsidianWikiLink('[[]]')).toBeUndefined();
    expect(parseObsidianWikiLink('[[sw2222|]]')).toBeUndefined();
    expect(parseObsidianWikiLink('[[outer [[inner]]]]')).toBeUndefined();
  });
});
