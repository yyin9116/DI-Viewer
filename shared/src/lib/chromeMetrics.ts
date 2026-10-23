/**
 * Sizing for the browser chrome (toolbar + tab strip).
 *
 * The rail already scales in three steps; the chrome above it did not, so a
 * 700px-wide window kept a 56px toolbar with 20px icons and 112px tabs — the
 * chrome was the last fixed-size block in a window that had otherwise become
 * fluid. One tier table drives every part of the bar (heights, icon sizes,
 * tab width, type size) so the whole thing scales as a unit instead of
 * half-scaling into clipping.
 *
 * Tiers are chosen by width, with the same thresholds as the rail, so the two
 * never disagree about which regime the window is in.
 *
 * KEEP IN STEP: the (minWidth, chromeHeight, railWidth) triples also exist as
 * `SHELL_CHROME_TIERS` in main.rs. The injected bootstrap needs the height
 * before React exists (it is what the page is inset by on the very first
 * layout), and it cannot read a TypeScript module — so the numbers are
 * declared twice on purpose, and the two copies have to match.
 */

export type ChromeTier = 'full' | 'mid' | 'small';

export interface ChromeMetrics {
  tier: ChromeTier;
  /** Left rail width — the chrome and the rail are one tier table. */
  rail: number;
  /** Toolbar height in px. */
  toolbar: number;
  /** Tab strip height in px. */
  strip: number;
  /** toolbar + strip — the value the page is inset by. */
  height: number;
  /** Primary toolbar icon (back / forward / new tab). */
  icon: number;
  /** Secondary icon (refresh, address-bar fields). */
  iconSm: number;
  /** Address field height. */
  address: number;
  /** Tab favicon / spinner. */
  favicon: number;
  /** Tab close glyph. */
  close: number;
  /** Tab title font size. */
  label: number;
  tabMin: number;
  tabMax: number;
  tabHeight: number;
}

const TIERS: Record<ChromeTier, Omit<ChromeMetrics, 'tier' | 'height' | 'tabHeight'>> = {
  full: {
    rail: 80,
    toolbar: 56,
    strip: 32,
    icon: 20,
    iconSm: 18,
    address: 36,
    favicon: 14,
    close: 12,
    label: 12,
    tabMin: 112,
    tabMax: 196
  },
  mid: {
    rail: 70,
    toolbar: 52,
    strip: 30,
    icon: 18,
    iconSm: 16,
    address: 32,
    favicon: 13,
    close: 11,
    label: 12,
    tabMin: 104,
    tabMax: 176
  },
  small: {
    rail: 60,
    toolbar: 46,
    strip: 28,
    icon: 16,
    iconSm: 15,
    address: 28,
    favicon: 12,
    close: 10,
    label: 11,
    tabMin: 96,
    tabMax: 156
  }
};

export function chromeTierFor(width: number): ChromeTier {
  if (width >= 1080) return 'full';
  if (width >= 860) return 'mid';
  return 'small';
}

export function chromeMetricsFor(width: number): ChromeMetrics {
  const tier = chromeTierFor(width);
  const base = TIERS[tier];
  return {
    tier,
    ...base,
    height: base.toolbar + base.strip,
    // 4px of breathing room inside the strip, exactly like the fixed 32/28.
    tabHeight: base.strip - 4
  };
}

/**
 * The numbers CSS needs, as custom properties on the chrome root. Arbitrary
 * `var(--chrome-…)` utilities inside the bar then read from one place, which is
 * what keeps the pieces from drifting apart.
 *
 * Icons are not listed: `<ChevronLeft size={…}>` takes a number, so the JSX
 * passes `metrics.icon` directly rather than round-tripping through CSS.
 */
export function chromeCssVars(metrics: ChromeMetrics): Record<string, string> {
  return {
    '--chrome-toolbar': `${metrics.toolbar}px`,
    '--chrome-strip': `${metrics.strip}px`,
    '--chrome-address': `${metrics.address}px`,
    '--chrome-favicon': `${metrics.favicon}px`,
    '--chrome-label': `${metrics.label}px`,
    '--chrome-tab-min': `${metrics.tabMin}px`,
    '--chrome-tab-max': `${metrics.tabMax}px`,
    '--chrome-tab-h': `${metrics.tabHeight}px`
  };
}
