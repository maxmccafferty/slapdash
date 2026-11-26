/*
 * GENERATED from docs/design/tokens.json. Do not edit.
 * Run `pnpm --filter @slapdash/web tokens` after changing the design tokens.
 */

/** Below this width the app uses the phone layout. CSS variables cannot be used in @media. */
export const PHONE_BREAKPOINT_PX = 900;

/** Minimum touch target, in px. */
export const TOUCH_TARGET_PX = 44;

/** Scene colours (hex) for the 3D renderer, which cannot read CSS variables. */
export const SCENE_COLORS = {
  paper: '#ffffff',
  floor: '#fbfbfc',
  dot: '#bfc5cd',
  ink: '#1a1a1a',
  keyDark: '#2b2b2b',
  muted: '#666664',
  signal: '#e8590c',
  hairline: '#ececea',
  concrete: '#dcd9d2',
} as const;

/** Every custom property in tokens.css, without the leading `--`. */
export const TOKEN_NAMES = [
  'color-paper',
  'color-floor',
  'color-unit',
  'color-track',
  'color-key-line',
  'color-hairline',
  'color-dot',
  'color-ink',
  'color-ink-soft',
  'color-muted',
  'color-key-dark',
  'color-signal',
  'color-signal-pressed',
  'color-wood',
  'color-concrete',
  'font-sans',
  'type-title-xl-size',
  'type-title-xl-line',
  'type-title-xl-weight',
  'type-title-l-size',
  'type-title-l-line',
  'type-title-l-weight',
  'type-title-m-size',
  'type-title-m-line',
  'type-title-m-weight',
  'type-spec-size',
  'type-spec-line',
  'type-spec-weight',
  'type-heading-size',
  'type-heading-line',
  'type-heading-weight',
  'type-body-size',
  'type-body-line',
  'type-body-weight',
  'type-list-size',
  'type-list-line',
  'type-list-weight',
  'type-key-size',
  'type-key-line',
  'type-key-weight',
  'type-label-size',
  'type-label-line',
  'type-label-weight',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'radius-key',
  'radius-field',
  'radius-unit',
  'radius-panel',
  'radius-sheet',
  'radius-full',
  'shadow-raised',
  'shadow-pressed',
  'shadow-modal',
  'size-touch',
  'size-talk',
  'size-chat-panel',
  'size-chat-panel-min',
  'size-swatch',
  'size-focus-ring',
  'breakpoint-phone',
  'motion-knob-duration',
  'motion-knob-easing',
  'motion-snap-duration',
  'motion-snap-easing',
  'motion-sheet-duration',
  'motion-sheet-easing',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
