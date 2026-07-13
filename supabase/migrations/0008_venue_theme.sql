-- Per-venue branding: hosts can tint the guest-facing wall (primary + accent
-- colors, page background) and pick a heading font from a fixed preset list.
-- All columns are nullable; NULL means "inherit the default UnityWall theme".
--
-- Colors are stored as validated 6-digit hex strings (#RRGGBB). The check
-- constraint is defense-in-depth — the app also validates via zod — so a bad
-- value can never reach the guest page and land inside a CSS custom property.
-- theme_font is constrained to the preset keys the client renders; see
-- lib/venue-theme.ts THEME_FONTS.

alter table public.events
  add column if not exists theme_primary text
    check (theme_primary is null or theme_primary ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists theme_accent text
    check (theme_accent is null or theme_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists theme_bg text
    check (theme_bg is null or theme_bg ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists theme_font text
    check (theme_font is null or theme_font in
      ('default', 'classic', 'modern', 'elegant', 'typewriter', 'rounded'));
