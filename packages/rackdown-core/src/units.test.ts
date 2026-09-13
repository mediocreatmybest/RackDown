import { describe, expect, it } from 'vitest';
import { inchesToMm, RACK_UNIT_MM, rackUnitsToMm } from './units.js';

describe('physical unit helpers', () => {
  it('uses the EIA rack-unit height', () => {
    expect(RACK_UNIT_MM).toBe(44.45);
    expect(rackUnitsToMm(2)).toBe(88.9);
    expect(rackUnitsToMm(0.5)).toBe(22.225);
  });

  it('converts common rack widths without assuming one standard', () => {
    expect(inchesToMm(10)).toBe(254);
    expect(inchesToMm(19)).toBeCloseTo(482.6, 10);
  });
});
