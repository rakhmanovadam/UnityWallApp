import type { CSSProperties } from "react";

// Per-venue branding. Hosts pick colors + a heading font on the dashboard;
// those values are stamped onto the guest wall as CSS custom-property overrides
// (see app/join/[code]/layout.tsx). Everything here is self-contained — the
// font presets use fonts the app already loads (Playfair, Hanken) or system
// stacks, so no external font fetch is needed and the CSP stays untouched.

export type VenueThemeFields = {
  theme_primary: string | null;
  theme_accent: string | null;
  theme_bg: string | null;
  theme_font: string | null;
};

export type ThemeFontKey =
  | "default"
  | "classic"
  | "modern"
  | "elegant"
  | "typewriter"
  | "rounded";

// key -> { label for the picker, font-family stack applied to headings }.
// "default" is a no-op (inherits the base --font-serif).
export const THEME_FONTS: Record<
  ThemeFontKey,
  { label: string; stack: string | null }
> = {
  default: { label: "UnityWall default", stack: null },
  classic: { label: "Classic serif", stack: "'Playfair Display', Georgia, serif" },
  modern: {
    label: "Modern sans",
    stack: "'Hanken Grotesk', system-ui, -apple-system, sans-serif",
  },
  elegant: { label: "Elegant", stack: "Georgia, 'Times New Roman', serif" },
  typewriter: {
    label: "Typewriter",
    stack: "'Courier New', ui-monospace, monospace",
  },
  rounded: {
    label: "Rounded",
    stack: "ui-rounded, 'Segoe UI', system-ui, sans-serif",
  },
};

// The default palette, mirrored from :root in public/styles.css. Used to render
// swatch defaults in the host picker so an unset venue shows the real base
// colors rather than empty inputs.
export const THEME_DEFAULTS = {
  primary: "#3A5676",
  accent: "#C28A3E",
  bg: "#FAF7F2",
} as const;

// Build the inline-style object that overrides the base CSS variables for a
// single venue subtree. Only the variables the host actually set are emitted,
// so unset fields keep inheriting the global theme. Values were already
// validated (hex / enum) at write time in the PATCH route, so nothing unsafe
// reaches the style attribute here.
export function venueThemeStyle(theme: VenueThemeFields): CSSProperties {
  const vars: Record<string, string> = {};

  if (theme.theme_primary) {
    vars["--dusk"] = theme.theme_primary;
    vars["--dusk-d"] = theme.theme_primary;
    vars["--dusk-l"] = theme.theme_primary;
    vars["--slate"] = theme.theme_primary;
  }
  if (theme.theme_accent) {
    vars["--amber"] = theme.theme_accent;
  }
  if (theme.theme_bg) {
    vars["--paper"] = theme.theme_bg;
    vars["--paper-2"] = theme.theme_bg;
    vars["--paper-3"] = theme.theme_bg;
  }

  const fontKey = (theme.theme_font ?? "default") as ThemeFontKey;
  const stack = THEME_FONTS[fontKey]?.stack;
  if (stack) {
    vars["--font-serif"] = stack;
  }

  return vars as CSSProperties;
}
