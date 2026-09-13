export const MILLIMETRES_PER_INCH = 25.4;
export const RACK_UNIT_MM = 44.45;
export const DEFAULT_RACK_WIDTH_INCHES = 19;
export const DIAGRAM_RACK_WIDTH_MM = inchesToMm(DEFAULT_RACK_WIDTH_INCHES);

export function inchesToMm(inches: number): number {
  return inches * MILLIMETRES_PER_INCH;
}

export function rackUnitsToMm(units: number): number {
  return units * RACK_UNIT_MM;
}
