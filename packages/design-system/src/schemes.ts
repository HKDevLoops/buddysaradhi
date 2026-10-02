// Implements: docs/design/overhaul-plan.md §1 — the 20 palettes, one per
// shortlisted Figma website colour scheme (10 dark + 10 light).
//
// PROVENANCE + HONEST LIMIT: the Figma resource library
// (https://www.figma.com/resource-library/website-color-schemes/) publishes 53
// scheme NAMES and a one-paragraph description each. The swatches are images:
// the article contains ZERO hex values (verified — no `#[0-9a-f]{3,8}` anywhere
// in the capture). So each palette here declares the **hue anchor, chroma
// tendency and ground temperature its description states**, and every colour is
// generated from that in `tokens.ts` and contrast-verified in CI. The Figma
// scheme number travels with the palette so any value can be checked against the
// article — and so replacing a generated value with the real swatch later is a
// one-line change, not a redesign.
//
// Research + shortlist rationale + collision analysis: docs/design/figma-schemes.md.

export type PaletteTier = "dark" | "light";

/** The semantic hues every palette must provide, whatever its family. */
export interface SemanticHues {
  /** Settled / paid / present. */
  success: number;
  /** Attention needed / pending / partial. */
  warning: number;
  /** Overdue / destructive / unpaid-and-late. */
  danger: number;
  /** Neutral information. */
  info: number;
}

export interface SchemeDefinition {
  id: string;
  name: string;
  tier: PaletteTier;
  /** Figma scheme number in the 53-scheme library. */
  figmaScheme: number;
  figmaName: string;
  /** Hue of the SURFACE family, in OKLCH degrees. */
  groundHue: number;
  /** Chroma tendency of the ground. Monochrome schemes sit near 0.004. */
  groundChroma: number;
  /** Hue of the single affordance colour. */
  accentHue: number;
  /** Chroma tendency of the accent. */
  accentChroma: number;
  /**
   * Lightness of the accent FILL, per tier. Optional: the default keeps the hue
   * vivid at a conventional mid lightness. A scheme whose identity IS a bright
   * hue (lemon, mustard, cinnamon) sets a higher lightness on the light tier so
   * the fill still reads as that colour instead of collapsing to olive.
   */
  accentLightness?: { dark?: number; light?: number };
  semantics: SemanticHues;
  /** What the article says this scheme is for, in one line. */
  note: string;
}

/** Shared semantic hues for the schemes whose description names none. */
const SEMANTIC_DEFAULT: SemanticHues = { success: 150, warning: 85, danger: 27, info: 235 };

export const SCHEMES: readonly SchemeDefinition[] = [
  // --- DARK TIER ----------------------------------------------------------
  {
    id: "inked",
    name: "Inked",
    tier: "dark",
    figmaScheme: 51,
    figmaName: "Inked",
    groundHue: 255,
    groundChroma: 0.005,
    accentHue: 195,
    accentChroma: 0.13,
    semantics: SEMANTIC_DEFAULT,
    note: "Teal accent on pure grayscale — the article calls the accent an affordance colour, not a mood colour.",
  },
  {
    id: "wraith",
    name: "Wraith",
    tier: "dark",
    figmaScheme: 52,
    figmaName: "Wraith",
    groundHue: 62,
    groundChroma: 0.014,
    accentHue: 158,
    accentChroma: 0.11,
    semantics: { success: 158, warning: 88, danger: 30, info: 232 },
    note: "Dark warm-brown ground with one emerald accent; grays and white 'create a sense of balance'.",
  },
  {
    id: "lapis-velvet",
    name: "Lapis Velvet Evening",
    tier: "dark",
    figmaScheme: 24,
    figmaName: "Lapis velvet evening",
    groundHue: 258,
    groundChroma: 0.032,
    accentHue: 300,
    accentChroma: 0.13,
    semantics: { success: 152, warning: 86, danger: 22, info: 240 },
    note: "Deep blue + plum; 'the most forgiving base for long reading sessions and dense figures' per the shortlist.",
  },
  {
    id: "yacht-club",
    name: "Yacht Club",
    tier: "dark",
    figmaScheme: 12,
    figmaName: "Yacht club",
    groundHue: 250,
    groundChroma: 0.014,
    accentHue: 272,
    accentChroma: 0.12,
    semantics: { success: 150, warning: 84, danger: 25, info: 230 },
    note: "Indigo on cool gray with a warm mahogany secondary — 'deeper shades add a grounding quality'.",
  },
  {
    id: "amber-walnut",
    name: "Amber Walnut Morning",
    tier: "dark",
    figmaScheme: 13,
    figmaName: "Amber walnut morning",
    groundHue: 55,
    groundChroma: 0.022,
    accentHue: 72,
    accentChroma: 0.12,
    semantics: { success: 145, warning: 78, danger: 30, info: 228 },
    note: "Single warm-brown family with 'excellent contrast' — no colour noise in a 200-row table.",
  },
  {
    id: "honey-opal",
    name: "Honey Opal Sunset",
    tier: "dark",
    figmaScheme: 17,
    figmaName: "Honey opal sunset",
    groundHue: 70,
    groundChroma: 0.02,
    accentHue: 92,
    accentChroma: 0.14,
    accentLightness: { dark: 0.76, light: 0.8 },
    semantics: { success: 148, warning: 88, danger: 28, info: 232 },
    note: "Mustard + taupe, one warm earth axis; yellow is the natural attention accent.",
  },
  {
    id: "rose-quartz",
    name: "Rose Quartz Evening",
    tier: "dark",
    figmaScheme: 19,
    figmaName: "Rose quartz evening",
    groundHue: 22,
    groundChroma: 0.026,
    accentHue: 8,
    accentChroma: 0.13,
    semantics: { success: 150, warning: 82, danger: 20, info: 246 },
    note: "Maroon ground reads 'serious and financial rather than playful'; blush tint for row banding.",
  },
  {
    id: "cocoa-topaz",
    name: "Cocoa Topaz Noonday",
    tier: "dark",
    figmaScheme: 15,
    figmaName: "Cocoa topaz noonday",
    groundHue: 52,
    groundChroma: 0.024,
    accentHue: 48,
    accentChroma: 0.16,
    accentLightness: { dark: 0.7, light: 0.66 },
    semantics: { success: 146, warning: 84, danger: 24, info: 244 },
    note: "Brown ground + one bright orange focal — the article names buttons/headlines as its use.",
  },
  {
    id: "amethyst-mint",
    name: "Amethyst Mint Harmony",
    tier: "dark",
    figmaScheme: 36,
    figmaName: "Amethyst mint harmony",
    groundHue: 295,
    groundChroma: 0.038,
    accentHue: 152,
    accentChroma: 0.15,
    semantics: { success: 152, warning: 88, danger: 20, info: 262 },
    note: "Moody purple/emerald base; the article mandates using its four bold hues 'sparingly'.",
  },
  {
    id: "royal-glimmer",
    name: "Royal Glimmer",
    tier: "dark",
    // The article names NO hue for this scheme ("deep jewel tones" only), so the
    // ground is derived as a near-neutral cool black and the three accents are
    // the jewel family the description does name. Flagged in the research as the
    // one palette whose hue is not stated.
    figmaScheme: 33,
    figmaName: "Royal glimmer",
    groundHue: 280,
    groundChroma: 0.012,
    accentHue: 340,
    accentChroma: 0.16,
    semantics: { success: 150, warning: 90, danger: 25, info: 255 },
    note: "Deep jewel tones — ruby accent on a near-neutral jewel ground.",
  },

  // --- LIGHT TIER ---------------------------------------------------------
  {
    id: "ink-wash",
    name: "Ink Wash",
    tier: "light",
    figmaScheme: 1,
    figmaName: "Ink wash",
    groundHue: 250,
    groundChroma: 0.003,
    accentHue: 250,
    accentChroma: 0.14,
    semantics: { success: 152, warning: 82, danger: 27, info: 248 },
    note: "Monochromatic gray — 'ideal for websites and apps that prioritize readability'; colour never does layout work.",
  },
  {
    id: "frosted-aura",
    name: "Frosted Aura",
    tier: "light",
    figmaScheme: 32,
    figmaName: "Frosted aura",
    groundHue: 245,
    groundChroma: 0.01,
    accentHue: 252,
    accentChroma: 0.13,
    semantics: { success: 154, warning: 84, danger: 26, info: 240 },
    note: "Slate gray + darker blue + pewter on stark white — named for law firms and financial institutions.",
  },
  {
    id: "slate-fintech",
    name: "Slate",
    tier: "light",
    figmaScheme: 49,
    figmaName: "Slate",
    groundHue: 250,
    groundChroma: 0.006,
    accentHue: 148,
    accentChroma: 0.13,
    semantics: { success: 148, warning: 82, danger: 26, info: 242 },
    note: "The only scheme naming fintech directly: pastel green accent on neutral gray, for status chips.",
  },
  {
    id: "lemon-granite",
    name: "Lemon Granite Morning",
    tier: "light",
    figmaScheme: 47,
    figmaName: "Lemon granite morning",
    groundHue: 248,
    groundChroma: 0.009,
    accentHue: 98,
    accentChroma: 0.15,
    // The scheme IS a bright yellow; a mid-lightness fill would read as olive.
    accentLightness: { dark: 0.8, light: 0.86 },
    semantics: { success: 150, warning: 80, danger: 26, info: 240 },
    note: "Gunmetal gray + blue with a bright yellow accent — named for financial services.",
  },
  {
    id: "neutral-elegance",
    name: "Neutral Elegance",
    tier: "light",
    figmaScheme: 2,
    figmaName: "Neutral elegance",
    groundHue: 74,
    groundChroma: 0.014,
    accentHue: 45,
    accentChroma: 0.11,
    semantics: { success: 146, warning: 82, danger: 28, info: 236 },
    note: "Beige + gray + brown, 'serene and professional' — no hue is strong enough to be mistaken for a status colour.",
  },
  {
    id: "frozen-mist",
    name: "Frozen Mist",
    tier: "light",
    figmaScheme: 11,
    figmaName: "Frozen mist",
    // A warm-gray ground, not the same cool gray as Ink Wash / Slate: the
    // verifier caught those two generating an identical canvas, and the article
    // distinguishes them by their ACCENT (cinnamon vs teal vs green), so the
    // ground is split by temperature to keep the two visibly different while
    // both stay "monochromatic gray" as described.
    groundHue: 75,
    groundChroma: 0.006,
    accentHue: 48,
    accentChroma: 0.15,
    accentLightness: { dark: 0.68, light: 0.6 },
    semantics: { success: 150, warning: 82, danger: 26, info: 240 },
    note: "Warm monochromatic gray with cinnamon — 'great for CTA buttons and clickable elements urging action'.",
  },
  {
    id: "amethyst-dawn",
    name: "Amethyst Dawn Haze",
    tier: "light",
    figmaScheme: 28,
    figmaName: "Amethyst dawn haze",
    groundHue: 305,
    groundChroma: 0.026,
    accentHue: 96,
    accentChroma: 0.15,
    accentLightness: { dark: 0.78, light: 0.84 },
    semantics: { success: 148, warning: 80, danger: 24, info: 280 },
    note: "Soft purple ground with vibrant yellow as the complement — 'draws the eye to buttons or calls to action'.",
  },
  {
    id: "sandstone-aquamarine",
    name: "Sandstone Aquamarine Serenity",
    tier: "light",
    figmaScheme: 16,
    figmaName: "Sandstone aquamarine serenity",
    groundHue: 70,
    groundChroma: 0.016,
    accentHue: 225,
    accentChroma: 0.13,
    semantics: { success: 146, warning: 80, danger: 26, info: 225 },
    note: "Earth ground + pastel blue accent, to be used 'sparingly for buttons, links, or highlighted text'.",
  },
  {
    id: "emerald-lavender",
    name: "Emerald Lavender Lake",
    tier: "light",
    figmaScheme: 26,
    figmaName: "Emerald lavender lake",
    groundHue: 168,
    groundChroma: 0.018,
    accentHue: 310,
    accentChroma: 0.13,
    semantics: { success: 152, warning: 82, danger: 26, info: 235 },
    note: "Low-chroma green/blue/lilac triad — nothing here can be misread as a semantic status colour.",
  },
  {
    id: "driftwood-pearl",
    name: "Driftwood Pearl Morning",
    tier: "light",
    figmaScheme: 5,
    figmaName: "Driftwood pearl morning",
    groundHue: 40,
    groundChroma: 0.012,
    accentHue: 232,
    accentChroma: 0.12,
    semantics: { success: 148, warning: 80, danger: 26, info: 232 },
    note: "Rose gold + brown + blue on light gray — 'a neutral background that enhances readability'.",
  },
];

export const SCHEMES_BY_ID: Readonly<Record<string, SchemeDefinition>> = Object.fromEntries(
  SCHEMES.map((scheme) => [scheme.id, scheme]),
);

export const DARK_SCHEMES = SCHEMES.filter((s) => s.tier === "dark");
export const LIGHT_SCHEMES = SCHEMES.filter((s) => s.tier === "light");
