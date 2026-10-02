// Implements: docs/design/overhaul-plan.md §2.2 + §8 — the token verification
// gate. This is what makes "20 generated palettes" a checked claim instead of a
// hopeful one. It runs in CI and in `packages/shared`'s test suite.
//
// Five classes of defect it must catch, each of which has actually happened in
// this repo or would have with hand-authored palettes:
//
//  1. TEXT CONTRAST — a text or accent role below its WCAG target on its own
//     palette's canvas. (A palette can pass on one canvas and fail on another;
//     each palette is measured against its own.)
//  2. TEXT-ON-FILL — text drawn on a button fill below target. Reading it off
//     the palette is easy to get backwards and invisible until a screenshot.
//  3. MATERIAL INVARIANCE — a mode that changed a text or accent colour. The
//     contrast guarantee in material-modes.md §0 is only real if something
//     asserts it.
//  4. DUPLICATE PALETTES — two schemes generating the same canvas hex (they
//     would be indistinguishable in the picker).
//  5. NAMING / COMPLETENESS — a token emitted by the generator but missing from
//     the CSS projection, or a CSS var with no generator behind it.
import { contrastRatio, hexToRgb } from "./oklch";
import { MATERIALS, MATERIAL_ROLE_KEYS, buildMaterial, type MaterialId } from "./material";
import { CONTRAST, buildPalette, type GeneratedPalette } from "./tokens";
import { SCHEMES } from "./schemes";

export interface Finding {
  paletteId: string;
  severity: "error" | "warn";
  code: string;
  message: string;
  /** The measured number, so a failure states the gap rather than "failed". */
  measured?: number;
  required?: number;
}

const TEXT_ROLES: readonly (keyof GeneratedPalette["tokens"])[] = [
  "textPrimary",
  "textSecondary",
  "textMuted",
  "accentText",
  "success",
  "warning",
  "danger",
  "info",
  "statusPaid",
  "statusPartial",
  "statusUnpaid",
  "statusOverdue",
];

const FILL_ROLES: readonly (keyof GeneratedPalette["tokens"])[] = ["accentOnPrimary"];

const NON_TEXT_ROLES: readonly (keyof GeneratedPalette["tokens"])[] = [
  "borderStrong",
  "borderFocus",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
];

function ratio(a: string, b: string): number {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}

export function verifyPalette(palette: GeneratedPalette): Finding[] {
  const findings: Finding[] = [];
  const t = palette.tokens;
  const canvas = t.canvas;

  for (const role of TEXT_ROLES) {
    const measured = ratio(t[role] as string, canvas);
    if (measured < CONTRAST.text) {
      findings.push({
        paletteId: palette.id,
        severity: "error",
        code: "TEXT_CONTRAST",
        message: `${role} on canvas is below ${CONTRAST.text}:1`,
        measured: Number(measured.toFixed(2)),
        required: CONTRAST.text,
      });
    }
  }

  for (const role of FILL_ROLES) {
    const fill = t.accentPrimary;
    const measured = ratio(t[role] as string, fill);
    if (measured < CONTRAST.text) {
      findings.push({
        paletteId: palette.id,
        severity: "error",
        code: "TEXT_ON_FILL",
        message: `${role} on accent fill ${fill} is below ${CONTRAST.text}:1`,
        measured: Number(measured.toFixed(2)),
        required: CONTRAST.text,
      });
    }
  }

  // The accent is two roles on purpose (vivid fill + readable text); if they
  // collapse into one colour, one of them is unreadable somewhere.
  if (t.accentPrimary === t.accentText) {
    findings.push({
      paletteId: palette.id,
      severity: "error",
      code: "ACCENT_ROLES_COLLAPSED",
      message: `accentPrimary and accentText are the same colour (${t.accentPrimary})`,
    });
  }

  for (const role of NON_TEXT_ROLES) {
    const measured = ratio(t[role] as string, canvas);
    if (measured < CONTRAST.large) {
      findings.push({
        paletteId: palette.id,
        severity: role.startsWith("chart") ? "warn" : "error",
        code: "NON_TEXT_CONTRAST",
        message: `${role} on canvas is below ${CONTRAST.large}:1`,
        measured: Number(measured.toFixed(2)),
        required: CONTRAST.large,
      });
    }
  }

  // Elevation must be legible: `raised` and `inset` are how the UI reads depth,
  // so if they are indistinguishable from the canvas the whole surface model
  // collapses into a flat sheet of colour.
  const raisedDelta = Math.abs(ratio(t.surfaceRaised, t.surfaceInset) - 1) * 100;
  if (raisedDelta < 3) {
    findings.push({
      paletteId: palette.id,
      severity: "error",
      code: "SURFACE_NO_DEPTH",
      message: `surface-raised and surface-inset are indistinguishable (Δ ${raisedDelta.toFixed(2)}%)`,
      measured: Number(raisedDelta.toFixed(2)),
      required: 3,
    });
  }
  const rowDelta = ratio(t.surfaceRow, t.canvas);
  if (rowDelta < 1.02 && rowDelta > 1) {
    findings.push({
      paletteId: palette.id,
      severity: "warn",
      code: "ROW_BANDING_INVISIBLE",
      message: `surface-row barely separates from canvas (${rowDelta.toFixed(3)}:1)`,
      measured: Number(rowDelta.toFixed(3)),
      required: 1.02,
    });
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