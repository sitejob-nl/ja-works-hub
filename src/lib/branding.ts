/** Centralized branding logic: read from org.settings, apply to CSS vars */

export interface BrandingSettings {
  accent_color?: string;      // HSL for --primary
  sidebar_bg?: string;        // HSL for --sidebar-bg
  sidebar_fg?: string;        // HSL for --sidebar-fg
  sidebar_fg_active?: string; // HSL for --sidebar-fg-active
  background?: string;        // HSL for --background
  card?: string;              // HSL for --card
  heading?: string;           // HSL for --heading
  border_radius?: string;     // e.g. "0.5rem"
}

export const BRANDING_DEFAULTS: Required<BrandingSettings> = {
  accent_color: '197 100% 60%',
  sidebar_bg: '224 60% 8%',
  sidebar_fg: '220 20% 70%',
  sidebar_fg_active: '0 0% 100%',
  background: '210 33% 98%',
  card: '0 0% 100%',
  heading: '224 60% 8%',
  border_radius: '0.5rem',
};

/** Parse "H S% L%" naar componenten; null bij onbruikbare input. */
function parseHsl(value: string): { h: number; s: number; l: number } | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const h = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  const l = parseInt(parts[2], 10);
  if ([h, s, l].some(Number.isNaN)) return null;
  return { h, s, l };
}

/**
 * Tekstvariant van de accentkleur: zelfde tint, maar lightness geclamped zodat
 * tekst op witte/lichte achtergronden leesbaar blijft (~4.5:1). Voorkomt dat
 * een licht gekozen accent (bv. "197 54% 95%") e-mails, entity-links en
 * match-percentages onleesbaar maakt — `--stat-blue` wordt app-breed als
 * tékstkleur gebruikt.
 */
export function textSafeAccent(accent: string): string {
  const hsl = parseHsl(accent);
  if (!hsl) return '197 100% 35%';
  return `${hsl.h} ${hsl.s}% ${Math.min(hsl.l, 38)}%`;
}

/** Derive sidebar hover & border from sidebar_bg */
function deriveSidebarColors(bg: string) {
  // Parse "H S% L%"
  const parts = bg.split(/\s+/);
  const h = parseInt(parts[0], 10) || 0;
  const s = parseInt(parts[1], 10) || 0;
  const l = parseInt(parts[2], 10) || 0;

  // If light sidebar, darken for hover, lighten for border
  if (l > 50) {
    return {
      hover: `${h} ${Math.max(s - 5, 0)}% ${Math.max(l - 6, 0)}%`,
      border: `${h} ${Math.max(s - 10, 0)}% ${Math.max(l - 10, 0)}%`,
      fg: `${h} ${Math.min(s + 10, 100)}% 30%`,
      fgActive: `${h} ${Math.min(s + 10, 100)}% 10%`,
    };
  }
  // Dark sidebar
  return {
    hover: `${h} ${Math.max(s - 20, 0)}% ${Math.min(l + 6, 100)}%`,
    border: `${h} ${Math.max(s - 30, 0)}% ${Math.min(l + 8, 100)}%`,
    fg: `${h} 20% 70%`,
    fgActive: '0 0% 100%',
  };
}

/** Apply branding settings to the document's CSS custom properties */
export function applyBranding(s: Partial<BrandingSettings>) {
  const root = document.documentElement.style;
  const accent = s.accent_color ?? BRANDING_DEFAULTS.accent_color;
  const sidebarBg = s.sidebar_bg ?? BRANDING_DEFAULTS.sidebar_bg;
  const derived = deriveSidebarColors(sidebarBg);

  root.setProperty('--primary', accent);
  root.setProperty('--ring', accent);
  root.setProperty('--accent-blue', accent);
  // --stat-blue is een TEKST-token (links, e-mails, scores) — altijd de
  // leesbare donkere afgeleide van het accent, nooit het rauwe accent.
  root.setProperty('--stat-blue', textSafeAccent(accent));

  root.setProperty('--sidebar-bg', sidebarBg);
  root.setProperty('--sidebar-hover', derived.hover);
  root.setProperty('--sidebar-border', derived.border);
  root.setProperty('--sidebar-fg', s.sidebar_fg ?? derived.fg);
  root.setProperty('--sidebar-fg-active', s.sidebar_fg_active ?? derived.fgActive);

  if (s.background) root.setProperty('--background', s.background);
  if (s.card) {
    root.setProperty('--card', s.card);
    root.setProperty('--popover', s.card);
  }
  if (s.heading) root.setProperty('--heading', s.heading);
  if (s.border_radius) root.setProperty('--radius', s.border_radius);
}

/** Reset all branding to defaults */
export function resetBranding() {
  applyBranding(BRANDING_DEFAULTS);
}
