import type { LayoutExternal, RectMm } from './layout.js';

export const BOTTOM_EXTERNAL_SEPARATION_MM = 80.2;
export const BOTTOM_EXTERNAL_ROW_PITCH_MM = 30;
const EPSILON_MM = 0.000001;

export interface ExternalPreference {
  external: LayoutExternal;
  centres: readonly number[];
}

export function preferredExternalX(
  centres: readonly number[],
  fallback: number,
): number {
  return centres.length === 0
    ? fallback
    : [...centres].sort((a, b) => a - b).reduce((sum, x) => sum + x, 0) /
        centres.length;
}

/** Fixed-width nearest-clear packing. Accepted boxes never move. */
export function packBottomExternals(
  preferences: readonly ExternalPreference[],
  fallbackX: number,
  floorY: number,
): Map<string, RectMm> {
  const ordered = preferences
    .map(({ external, centres }) => ({
      external,
      preferredX: preferredExternalX(centres, fallbackX),
      key: JSON.stringify([
        external.label,
        external.link?.style ?? null,
        external.link?.target ?? null,
      ]),
    }))
    .sort(
      (a, b) =>
        a.preferredX - b.preferredX ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  const rows: number[][] = [];
  const positions = new Map<string, RectMm>();
  for (const { external, preferredX } of ordered) {
    for (let rowIndex = 0; ; rowIndex++) {
      const row = rows[rowIndex] ?? [];
      const candidates = [
        preferredX,
        ...row.flatMap((x) => [
          x - BOTTOM_EXTERNAL_SEPARATION_MM,
          x + BOTTOM_EXTERNAL_SEPARATION_MM,
        ]),
      ]
        .filter((x) =>
          row.every(
            (other) =>
              x <= other - BOTTOM_EXTERNAL_SEPARATION_MM ||
              x >= other + BOTTOM_EXTERNAL_SEPARATION_MM,
          ),
        )
        .sort((a, b) => {
          const delta = Math.abs(a - preferredX) - Math.abs(b - preferredX);
          return Math.abs(delta) <= EPSILON_MM ? a - b : delta;
        });
      const x = candidates[0];
      if (
        x === undefined ||
        Math.abs(x - preferredX) > BOTTOM_EXTERNAL_SEPARATION_MM + EPSILON_MM
      )
        continue;
      row.push(x);
      rows[rowIndex] = row;
      positions.set(external.id, {
        xMm: x - 38.1,
        yMm: floorY + rowIndex * BOTTOM_EXTERNAL_ROW_PITCH_MM,
        widthMm: 76.2,
        heightMm: 16,
      });
      break;
    }
  }
  return positions;
}
