// Implements: docs/design/overhaul-plan.md §6 — validate the desktop token
// artefacts against the contracts they have to satisfy, without needing a Rust
// toolchain (which this repo's CI does not have for a bare `tauri build`).
//
//   node apps/desktop/scripts/verify-tokens.mjs
//
// Checks, all fail-closed:
//   1. every generated file is byte-identical to a fresh generator run
//      (so nobody hand-edited a DO NOT EDIT file)
//   2. each Tauri config validates against
//      @tauri-apps/cli config.schema.json (the schema Tauri actually ships)
//   3. the window-effects mapping only uses effect values that schema allows
//   4. apps/mobile and apps/desktop emit the same custom properties (the
//      cross-platform contract in docs/design/platform-tokens.md §7)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "..", "..");

const failures = [];
const fail = (message) => failures.push(message);

// --- 1. generated files are reproducible ------------------------------------

const generated = [
  join(appRoot, "src", "styles", "tokens.css"),
  join(appRoot, "src", "theme", "tokens.ts"),
  join(appRoot, "src", "theme", "native.ts"),
  join(appRoot, "src-tauri", "tauri.windows.conf.json"),
  join(appRoot, "src-tauri", "tauri.macos.conf.json"),
  join(appRoot, "src-tauri", "tauri.linux.conf.json"),
];

const before = new Map(generated.map((file) => [file, readFileSync(file, "utf8")]));
execFileSync(process.execPath, [join(appRoot, "scripts", "generate-tokens.mjs")], {
  stdio: "ignore",
});
for (const file of generated) {
  if (readFileSync(file, "utf8") !== before.get(file)) {
    fail(`generated file is stale or hand-edited: ${file}`);
  }
}

// --- 2. Tauri configs against the shipped schema ----------------------------

const schema = require(join(appRoot, "node_modules", "@tauri-apps/cli", "config.schema.json"));

/** Minimal structural validator for the subset this repo writes. */
function validate(instance, node, pointer, effectsAllowed) {
  if (!node || typeof node !== "object") return;
  if (node.$ref) {
    const match = /^#\/definitions\/(.+)$/.exec(node.$ref);
    if (!match) {
      fail(`${pointer}: unsupported $ref ${node.$ref}`);
      return;
    }
    validate(instance, schema.definitions[match[1]], pointer, effectsAllowed);
    return;
  }
  if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
    const variants = [...(node.oneOf ?? []), ...(node.anyOf ?? [])].filter(
      (v) => typeof v.type !== "string" || v.type !== "null",
    );
    for (const variant of variants) {
      const localFailures = failures.length;
      validate(instance, variant, pointer, effectsAllowed);
      if (failures.length === localFailures) return;
      while (failures.length > localFailures) failures.pop();
    }
    fail(`${pointer}: no schema variant matched`);
    return;
  }
  if (node.enum) {
    if (!node.enum.includes(instance)) fail(`${pointer}: "${instance}" is not in the enum`);
    return;
  }
  if (node.type === "array") {
    if (!Array.isArray(instance)) {
      fail(`${pointer}: expected an array`);
      return;
    }
    if (node.minItems && instance.length < node.minItems) fail(`${pointer}: too few items`);
    if (node.maxItems && instance.length > node.maxItems) fail(`${pointer}: too many items`);
    if (effectsAllowed && pointer.endsWith("/effects")) {
      for (const value of instance) {
        if (!effectsAllowed.has(value)) fail(`${pointer}: "${value}" is not a Tauri WindowEffect`);
      }
    }
    instance.forEach((item, index) => validate(item, node.items, `${pointer}/${index}`, effectsAllowed));
    return;
  }
  if (node.type === "object" || node.properties) {
    if (typeof instance !== "object" || instance === null || Array.isArray(instance)) {
      fail(`${pointer}: expected an object`);
      return;
    }
    for (const required of node.required ?? []) {
      if (!(required in instance)) fail(`${pointer}: missing required "${required}"`);
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!(key in (node.properties ?? {}))) fail(`${pointer}: unexpected property "${key}"`);
      }
    }
    for (const [key, value] of Object.entries(instance)) {
      const child = node.properties?.[key];
      if (child) validate(value, child, `${pointer}/${key}`, effectsAllowed);
    }
    return;
  }
  if (typeof node.type === "string" && instance !== null) {
    const actual = Array.isArray(instance) ? "array" : typeof instance;
    if (node.type === "integer" && actual === "number") return;
    if (node.type === "number" && actual === "number") return;
    if (node.type === "boolean" && actual === "boolean") return;
    if (node.type === "string" && actual === "string") {
      if (node.pattern && !new RegExp(node.pattern).test(instance)) {
        fail(`${pointer}: "${instance}" does not match ${node.pattern}`);
      }
      return;
    }
    if (actual !== node.type) fail(`${pointer}: expected ${node.type}, got ${actual}`);
  }
}

const effectNames = (schema.definitions.WindowEffect.oneOf ?? [])
  .flatMap((v) => v.enum ?? [])
  .filter((v) => typeof v === "string");
const effectsAllowed = new Set(effectNames);

const tauriConfigs = [
  { file: join(appRoot, "src-tauri", "tauri.conf.json"), node: schema, pick: (c) => c },
  {
    file: join(appRoot, "src-tauri", "tauri.windows.conf.json"),
    node: { $ref: "#/definitions/AppConfig" },
    pick: (c) => c.app,
  },
  {
    file: join(appRoot, "src-tauri", "tauri.macos.conf.json"),
    node: { $ref: "#/definitions/AppConfig" },
    pick: (c) => c.app,
  },
  {
    file: join(appRoot, "src-tauri", "tauri.linux.conf.json"),
    node: { $ref: "#/definitions/AppConfig" },
    pick: (c) => c.app,
  },
];
for (const { file, node, pick } of tauriConfigs) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (pick(config) === undefined) {
    fail(`${join("tauri", file.split(/[\\/]/).pop())}: no \`app\` block to validate`);
    continue;
  }
  validate(pick(config), node, join("tauri", file.split(/[\\/]/).pop()), effectsAllowed);
}

// --- 3. the mapping only names real effects ---------------------------------

const nativeSource = readFileSync(join(appRoot, "src", "theme", "native.ts"), "utf8");
for (const match of nativeSource.matchAll(/effects: \[([^\]]+)\]/g)) {
  for (const name of match[1].split(",")) {
    const value = name.trim().replaceAll('"', "");
    if (value && !effectsAllowed.has(value)) fail(`native.ts names an unknown effect "${value}"`);
  }
}

// --- 4. cross-platform custom-property parity -------------------------------

const propertyNames = (css) =>
  new Set([...css.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]));

const desktopProps = propertyNames(readFileSync(join(appRoot, "src", "styles", "tokens.css"), "utf8"));
const mobileProps = propertyNames(readFileSync(join(repoRoot, "apps", "mobile", "tokens.css"), "utf8"));
for (const name of desktopProps) {
  if (!mobileProps.has(name)) fail(`desktop emits --${name} but apps/mobile does not`);
}
for (const name of mobileProps) {
  if (!desktopProps.has(name)) fail(`apps/mobile emits --${name} but desktop does not`);
}

if (failures.length > 0) {
  process.stderr.write(`FAIL: ${failures.length} problem(s)\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  [
    `ok: ${generated.length} generated files are reproducible`,
    `ok: ${tauriConfigs.length} Tauri configs validate against @tauri-apps/cli config.schema.json`,
    `ok: window effects drawn from ${effectNames.length} schema-declared WindowEffect values`,
    `ok: ${desktopProps.size} custom properties identical across apps/mobile and apps/desktop`,
    "",
  ].join("\n"),
);