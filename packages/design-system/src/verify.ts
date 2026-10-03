// Implements: docs/design/overhaul-plan.md §8 — the token verification gate. This
// is what makes "20 generated palettes" a checked claim instead of a hopeful one.
//
// The FIRST version of this gate solved and measured every text role against
// `canvas` alone. A measurement pass then found 240 of 640 real pairings below
// target, because the app paints most of its text on `--surface-raised`,
// `--surface-inset` and `--surface-row`, and a colour solved against the canvas
// drifts the wrong way on one of those every time (`surface-raised` is LIGHTER
// than the canvas on a dark tier; `surface-inset` is DARKER on a light tier). The
// same pass found `--border-default` below 3:1 on all 20 palettes against all four
// surfaces — and that role was not in the checked list at all, while being the
// border on every unselected button, table row, search field and divider.
//
// Six classes of defect must fail here, each of which has already happened:
//   1. TEXT CONTRAST on every surface the app paints on, not just the canvas.
//   2. TEXT-ON-FILL — text drawn on a button fill.
//   3. COMPOSITE — a status colour on a 14%-tinted chip surface (§2.3), where the
//      real background is neither token.
//   4. NON-TEXT — borders and data marks against every surface, including
//      `--border-default`.
//   5. MATERIAL INVARIANCE — a mode that changed a text or accent colour.
//   6. STRUCTURE — a duplicate canvas, an invisible surface hierarchy, or a role
//      collapsing onto another.
import { contrastRatio, hexToRgb } from "./oklch";
import { MATERIALS, MATERIAL_ROLE_KEYS, buildMaterial, type MaterialId } from "./material";
import { CONTRAST, buildPalette, type GeneratedPalette, type PaletteTokens } from "./tokens";
import {
  NON_TEXT_ROLE_KEYS,
  TEXT_ROLE_KEYS,
  TEXT_SURFACES,
  borderPairings,
  compositePairings,
  overlayLegibility,
  ratio,
  textPairings,
  type SurfaceKey,
} from "./surfaces";
import { SCHEMES } from "./schemes";

export type { SurfaceKey };

export interface Finding {
  paletteId: string;
  severity: "error" | "warn";
  code: string;
  message: string;
  measured?: number;
  required?: number;
  role?: string;
  surface?: string;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function verifyPalette(palette: GeneratedPalette): Finding[] {
  const findings: Finding[] = [];
  const t = palette.tokens;
  const at = (paletteId: string): string => paletteId;

  for (const pairing of textPairings(palette)) {
    if (pairing.ratio < CONTRAST.text) {
      findings.push({
        paletteId: at(palette.id),
        severity: "error",
        code: "TEXT_CONTRAST",
        role: pairing.role,
        surface: pairing.surface,
        message: `${pairing.role} on --${pairing.surface.replace(/([A-Z])/g, "-$1").toLowerCase()} is below ${CONTRAST.text}:1`,
        measured: round(pairing.ratio),
        required: CONTRAST.text,
      });
    }
  }

  const onFill = ratio(t.accentOnPrimary, t.accentPrimary);
  if (onFill < CONTRAST.text) {
    findings.push({
      paletteId: at(palette.id),
      severity: "error",
      code: "TEXT_ON_FILL",
      message: `--accent-on-primary on --accent-primary ${t.accentPrimary} is below ${CONTRAST.text}:1`,
      measured: round(onFill),
      required: CONTRAST.text,
    });
  }

  for (const pairing of compositePairings(palette)) {
    if (pairing.ratio < CONTRAST.text) {
      findings.push({
        paletteId: at(palette.id),
        severity: "error",
        code: "COMPOSITE_CONTRAST",
        role: pairing.role,
        message: `${pairing.role} (14% tinted chip surface) is below ${CONTRAST.text}:1`,
        measured: round(pairing.ratio),
        required: CONTRAST.text,
      });
    }
  }

  for (const pairing of borderPairings(palette)) {
    if (pairing.ratio < CONTRAST.large) {
      findings.push({
        paletteId: at(palette.id),
        // Chart marks are data, not controls; a series that sits slightly under the
        // non-text floor is a warning so the palette can still ship with a record.
        severity: pairing.role.startsWith("chart") ? "warn" : "error",
        code: "NON_TEXT_CONTRAST",
        role: pairing.role,
        surface: pairing.surface,
        message: `${pairing.role} on --${pairing.surface.replace(/([A-Z])/g, "-$1").toLowerCase()} is below ${CONTRAST.large}:1`,
        measured: round(pairing.ratio),
        required: CONTRAST.large,
      });
    }
  }

  for (const pairing of overlayLegibility(palette)) {
    if (pairing.ratio < CONTRAST.text) {
      findings.push({
        paletteId: at(palette.id),
        severity: "error",
        code: "OVERLAY_TEXT_CONTRAST",
        role: pairing.role,
        message: `${pairing.role} is below ${CONTRAST.text}:1 — the translucent surfaces composite over unknown content, so the solid twin is the worst realistic backdrop`,
        measured: round(pairing.ratio),
        required: CONTRAST.text,
      });
    }
  }

  if (t.accentPrimary === t.accentText) {
    findings.push({
      paletteId: at(palette.id),
      severity: "error",
      code: "ACCENT_ROLES_COLLAPSED",
      message: `accentPrimary and accentText are the same colour (${t.accentPrimary})`,
    });
  }

  if (t.textPrimary === t.textSecondary || t.textSecondary === t.textMuted || t.textPrimary === t.textMuted) {
    findings.push({
      paletteId: at(palette.id),
      severity: "error",
      code: "TEXT_HIERARCHY_COLLAPSED",
      message: "two text roles resolved to the same colour",
    });
  }

  // Elevation must be legible: `raised` and `inset` are how the UI reads depth, so
  // if they are indistinguishable the whole surface model collapses into one sheet.
  const depth = ratio(t.surfaceRaised, t.surfaceInset);
  if (depth <= 1.03) {
    findings.push({
      paletteId: at(palette.id),
      severity: "error",
      code: "SURFACE_NO_DEPTH",
      message: "surface-raised and surface-inset are indistinguishable",
      measured: round(depth),
      required: 1.03,
    });
  }

  const rowDelta = ratio(t.surfaceRow, t.canvas);
  if (rowDelta < 1.01) {
    findings.push({
      paletteId: at(palette.id),
      severity: "error",
      code: "ROW_BANDING_INVISIBLE",
      message: "surface-row barely separates from canvas — zebra striping in a dense ledger would be invisible",
      measured: round(rowDelta),
      required: 1.01,
    });
  }

  // A surface the app cannot distinguish is a surface role that was never needed.
  for (const key of TEXT_SURFACES) {
    const hex = t[key as keyof PaletteTokens] as string;
    if (!/^#[0-9A-F]{6}$/i.test(hex)) {
      findings.push({
        paletteId: at(palette.id),
        severity: "error",
        code: "SURFACE_NOT_SOLID",
        surface: key,
        message: `--${key} is not a solid hex (${hex})`,
      });
    }
  }

  return findings;
}

export function verifyMaterialInvariance(
  palette: GeneratedPalette,
  materials: readonly MaterialId[],
): Finding[] {
  const findings: Finding[] = [];
  const baseline = buildMaterial(palette, MATERIALS[materials[0] as MaterialId]);
  for (const id of materials.slice(1)) {
    const candidate = buildMaterial(palette, MATERIALS[id]);
    for (const key of Object.keys(baseline)) {
      if (!MATERIAL_ROLE_KEYS.includes(key)) {
        findings.push({
          paletteId: palette.id,
          severity: "error",
          code: "MATERIAL_ROLE_UNDECLARED",
          message: `${key} is not declared in MATERIAL_ROLE_KEYS`,
        });
        continue;
      }
      if (candidate[key] !== baseline[key] && key.startsWith("text")) {
        findings.push({
          paletteId: palette.id,
          severity: "error",
          code: "MATERIAL_CHANGED_TEXT",
          message: `material ${id} changed ${key}`,
        });
      }
    }
  }
  return findings;
}

export function verifyUniqueness(palettes: readonly GeneratedPalette[]): Finding[] {
  const findings: Finding[] = [];
  const byCanvas = new Map<string, string[]>();
  for (const palette of palettes) {
    const key = palette.tokens.canvas.toUpperCase();
    byCanvas.set(key, [...(byCanvas.get(key) ?? []), palette.id]);
  }
  for (const [canvas, ids] of byCanvas) {
    if (ids.length > 1) {
      findings.push({
        paletteId: ids.join(", "),
        severity: "error",
        code: "DUPLICATE_PALETTE",
        message: `these palettes generate the same canvas ${canvas}`,
      });
    }
  }
  return findings;
}

export interface TokenBundle {
  palettes: GeneratedPalette[];
  findings: Finding[];
}

/** Build every palette from the scheme table and verify the whole set. */
export function buildAndVerify(): TokenBundle {
  const palettes = SCHEMES.map(buildPalette);
  const findings: Finding[] = [];
  for (const palette of palettes) findings.push(...verifyPalette(palette));
  findings.push(...verifyUniqueness(palettes));
  const materials = Object.keys(MATERIALS) as MaterialId[];
  for (const palette of palettes) findings.push(...verifyMaterialInvariance(palette, materials));
  return { palettes, findings };
}

export {
  contrastRatio,
  hexToRgb,
  borderPairings,
  compositePairings,
  overlayLegibility,
  textPairings,
  TEXT_ROLE_KEYS,
  NON_TEXT_ROLE_KEYS,
  TEXT_SURFACES,
};
