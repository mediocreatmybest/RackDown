import type {
  ConnectionColourMode,
  SvgConnectionRouting,
  SvgExternalPlacement,
  SvgRenderOptions,
} from '@rackdown/core';

export interface RackDownPluginSettings {
  routing: SvgConnectionRouting;
  externalPlacement: SvgExternalPlacement;
  connectionColourMode: ConnectionColourMode;
  connectionThickness: number;
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Readonly<RackDownPluginSettings> = {
  routing: 'perimeter',
  externalPlacement: 'bottom',
  connectionColourMode: 'auto',
  connectionThickness: 2,
  theme: 'auto',
};

export const CONNECTION_THICKNESS = { min: 1, max: 4, step: 0.25 } as const;

/** Keep finite fractions unchanged; the slider alone advances in quarter steps. */
function normalizeConnectionThickness(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(
        CONNECTION_THICKNESS.max,
        Math.max(CONNECTION_THICKNESS.min, value),
      )
    : DEFAULT_SETTINGS.connectionThickness;
}

export const ROUTING_CHOICES = {
  perimeter: 'Perimeter',
  direct: 'Direct',
  orthogonal: 'Orthogonal',
  lanes: 'Lanes',
} satisfies Record<SvgConnectionRouting, string>;

export const EXTERNAL_PLACEMENT_CHOICES = {
  bottom: 'Bottom',
  right: 'Right',
} satisfies Record<SvgExternalPlacement, string>;

export const CONNECTION_COLOUR_CHOICES = {
  auto: 'Auto',
  monochrome: 'Monochrome',
} satisfies Record<ConnectionColourMode, string>;

export const THEME_CHOICES = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
} satisfies Record<RackDownPluginSettings['theme'], string>;

function supportedValue<T extends string>(
  value: unknown,
  choices: Record<T, string>,
  fallback: T,
): T {
  return typeof value === 'string' && Object.hasOwn(choices, value)
    ? (value as T)
    : fallback;
}

export function normalizeSettings(data: unknown): RackDownPluginSettings {
  const saved =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  return {
    routing: supportedValue(
      saved.routing,
      ROUTING_CHOICES,
      DEFAULT_SETTINGS.routing,
    ),
    externalPlacement: supportedValue(
      saved.externalPlacement,
      EXTERNAL_PLACEMENT_CHOICES,
      DEFAULT_SETTINGS.externalPlacement,
    ),
    connectionColourMode: supportedValue(
      saved.connectionColourMode,
      CONNECTION_COLOUR_CHOICES,
      DEFAULT_SETTINGS.connectionColourMode,
    ),
    theme: supportedValue(saved.theme, THEME_CHOICES, DEFAULT_SETTINGS.theme),
    connectionThickness: normalizeConnectionThickness(
      saved.connectionThickness,
    ),
  };
}

/** Resolve host policy once, including calls made without plugin settings. */
export function resolveObsidianRenderOptions(
  options: SvgRenderOptions = {},
  settings: RackDownPluginSettings = DEFAULT_SETTINGS,
): SvgRenderOptions {
  return {
    ...options,
    connectionStyle: {
      ...options.connectionStyle,
      width: options.connectionStyle?.width ?? settings.connectionThickness,
    },
    connectionRouting: options.connectionRouting ?? settings.routing,
    externalPlacement: options.externalPlacement ?? settings.externalPlacement,
    connectionColourMode:
      options.connectionColourMode ?? settings.connectionColourMode,
    theme:
      options.theme === 'none'
        ? settings.theme
        : (options.theme ?? settings.theme),
    sizing: 'responsive',
  };
}
