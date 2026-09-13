import { describe, expect, it } from 'vitest';
import { classifyHostNavigation } from './host-navigation.js';

describe('classifyHostNavigation', () => {
  it('classifies wiki target as internal navigation', () => {
    expect(
      classifyHostNavigation('wiki', 'Infrastructure/Racks/Garage'),
    ).toEqual({
      kind: 'internal',
      target: 'Infrastructure/Racks/Garage',
    });
    expect(classifyHostNavigation('wiki', '../Garage')).toEqual({
      kind: 'internal',
      target: '../Garage',
    });
  });

  it('classifies Markdown relative target as internal navigation', () => {
    expect(
      classifyHostNavigation('markdown', 'Infrastructure/Racks/Garage.md'),
    ).toEqual({
      kind: 'internal',
      target: 'Infrastructure/Racks/Garage.md',
    });
    expect(classifyHostNavigation('markdown', '../Garage.md')).toEqual({
      kind: 'internal',
      target: '../Garage.md',
    });
  });

  it('classifies Markdown .md path as internal navigation', () => {
    expect(classifyHostNavigation('markdown', 'Garage.md')).toEqual({
      kind: 'internal',
      target: 'Garage.md',
    });
  });

  it('classifies Markdown heading target as internal navigation', () => {
    expect(classifyHostNavigation('markdown', '#Ports')).toEqual({
      kind: 'internal',
      target: '#Ports',
    });
    expect(
      classifyHostNavigation('markdown', 'Devices/Switch.md#Ports'),
    ).toEqual({
      kind: 'internal',
      target: 'Devices/Switch.md#Ports',
    });
  });

  it('classifies HTTP target as external web navigation', () => {
    expect(
      classifyHostNavigation('markdown', 'http://example.com/device'),
    ).toEqual({
      kind: 'external-url',
      target: 'http://example.com/device',
    });
  });

  it('classifies HTTPS target as external web navigation', () => {
    expect(
      classifyHostNavigation('markdown', 'https://example.com/device?query=1'),
    ).toEqual({
      kind: 'external-url',
      target: 'https://example.com/device?query=1',
    });
  });

  it('handles HTTP and HTTPS schemes case-insensitively', () => {
    expect(
      classifyHostNavigation('markdown', 'HTTP://EXAMPLE.COM/DOCS'),
    ).toEqual({
      kind: 'external-url',
      target: 'HTTP://EXAMPLE.COM/DOCS',
    });
    expect(
      classifyHostNavigation('markdown', 'Https://Example.Com/API'),
    ).toEqual({
      kind: 'external-url',
      target: 'Https://Example.Com/API',
    });
  });

  it('returns none for plain external or empty target', () => {
    expect(classifyHostNavigation('none', 'ISP Handover')).toEqual({
      kind: 'none',
      target: '',
    });
    expect(classifyHostNavigation('none', undefined)).toEqual({
      kind: 'none',
      target: '',
    });
    expect(classifyHostNavigation('wiki', '')).toEqual({
      kind: 'none',
      target: '',
    });
    expect(classifyHostNavigation('markdown', '   ')).toEqual({
      kind: 'none',
      target: '',
    });
    expect(classifyHostNavigation(undefined, 'target')).toEqual({
      kind: 'none',
      target: '',
    });
  });
});
