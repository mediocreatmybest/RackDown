export type HostNavigationKind = 'internal' | 'external-url' | 'none';

export interface HostNavigation {
  kind: HostNavigationKind;
  target: string;
}

const HTTP_OR_HTTPS_PATTERN = /^https?:\/\//i;

/**
 * Classifies external reference navigation intent for the Obsidian host adapter.
 * Wiki targets and internal Markdown targets navigate within the Obsidian vault,
 * while HTTP/HTTPS targets open as external web URLs. Plain externals with
 * style 'none' or missing/empty targets perform no navigation.
 */
export function classifyHostNavigation(
  linkStyle: string | null | undefined,
  rawTarget: string | null | undefined,
): HostNavigation {
  const target = rawTarget?.trim() ?? '';
  if (!target || !linkStyle || linkStyle === 'none') {
    return { kind: 'none', target: '' };
  }

  if (linkStyle === 'wiki') {
    return { kind: 'internal', target };
  }

  if (linkStyle === 'markdown') {
    if (HTTP_OR_HTTPS_PATTERN.test(target)) {
      return { kind: 'external-url', target };
    }
    return { kind: 'internal', target };
  }

  return { kind: 'none', target: '' };
}
