/** Frozen conservative costs in tenths of an SVG user unit at 10px. */
export const ASCII_WIDTH_TENTHS: readonly number[] = Object.freeze([
  32, 41, 47, 84, 64, 96, 79, 28, 40, 40, 50, 84, 32, 37, 32, 34, 64, 64, 64,
  64, 64, 64, 64, 64, 64, 64, 34, 34, 84, 84, 84, 56, 102, 69, 69, 73, 78, 67,
  62, 78, 76, 30, 53, 68, 57, 87, 75, 79, 67, 79, 73, 67, 64, 74, 69, 99, 69,
  68, 69, 40, 34, 40, 84, 56, 50, 62, 64, 55, 64, 62, 36, 64, 64, 28, 28, 58,
  28, 98, 64, 62, 64, 64, 42, 53, 40, 64, 60, 82, 60, 60, 53, 64, 34, 64, 84,
]);

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const WIDTH_BUDGET_TENTHS = 672;
const ELLIPSIS_TENTHS = 100;

export function externalLabelWidthTenths(value: string): number {
  let cost = 0;
  for (const scalar of value) {
    const code = scalar.codePointAt(0) as number;
    if (code >= 0x20 && code <= 0x7e) {
      cost += ASCII_WIDTH_TENTHS[code - 0x20] as number;
    } else if (code === 0x2026) {
      cost += ELLIPSIS_TENTHS;
    } else if (![0x200c, 0x200d, 0xfe0e, 0xfe0f].includes(code)) {
      cost += 140;
    }
  }
  return cost;
}

/** Display copy only: semantic labels and keys must retain the original. */
export function externalDisplayLabel(original: string): string {
  const normalized = original
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: explicit display sanitization contract
      /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
      '',
    );
  const graphemes = Array.from(
    segmenter.segment(normalized),
    (part) => part.segment,
  );
  if (
    graphemes.length <= 24 &&
    externalLabelWidthTenths(normalized) <= WIDTH_BUDGET_TENTHS
  ) {
    return normalized;
  }
  let prefix = '';
  let cost = ELLIPSIS_TENTHS;
  for (const grapheme of graphemes.slice(0, 23)) {
    const next = externalLabelWidthTenths(grapheme);
    if (cost + next > WIDTH_BUDGET_TENTHS) break;
    prefix += grapheme;
    cost += next;
  }
  return `${prefix.trimEnd()}…`;
}
