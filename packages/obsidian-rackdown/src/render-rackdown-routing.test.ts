import { describe, expect, it } from 'vitest';
import { renderRackDown } from './render-rackdown.js';

const SOURCE = `rack "Lab" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
core:1 -- pve1:1`;

describe('Obsidian connection routing', () => {
  it('uses perimeter routing by default', () => {
    const result = renderRackDown(SOURCE);

    expect(result.svg).toContain('data-connection-routing="perimeter"');
    expect(result.svg).toContain('data-routing="perimeter"');
  });

  it('allows an explicit renderer option to override the host default', () => {
    const result = renderRackDown(SOURCE, { connectionRouting: 'direct' });

    expect(result.svg).toContain('data-connection-routing="direct"');
    expect(result.svg).toContain('<line ');
  });
});
