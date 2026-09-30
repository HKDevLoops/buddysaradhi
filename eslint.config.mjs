import js from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules/",
      "**/.next/",
      ".next/",
      "out/",
      "dist/",
      "build/",
      ".turbo/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "blob-report/",
      "*.db",
      "*.db-journal",
      "*.db-wal",
      "*.db-shm",
      "**/*.d.ts",
      // Build output and local artifacts (mirrors .gitignore).
      ".vercel/",
      // Agent / skill tooling — vendored scripts, not product code.
      ".claude/",
      ".agents/",
      ".agent/",
      ".kilo/",
      ".opencode/",
      ".github/skills/",
      ".testsprite/",
      ".ruff_cache/",
      ".playwright-mcp/",
      ".freebuff/",
      // Scratch, reference material, and one-off verification harnesses.
      "scratch/",
      "reference-implementations/",
      "testsprite_tests/",
      // Nested configs are authoritative for these directories; their package
      // scripts are the CI gate. apps/mobile's expo flat config crashes
      // typescript-eslint under TS 7 (FM-17) and its lint script skips linting;
      // apps/desktop's eslint config parses .ts with plain espree (pre-existing)
      // and its CI gate is oxlint. Root `eslint .` must not double-lint them.
      "apps/mobile/**",
      "apps/desktop/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        NodeJS: "readonly",
        // Node 22 globals used by root scripts/ helpers.
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        globalThis: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        performance: "readonly",
        structuredClone: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        crypto: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { caughtErrorsIgnorePattern: "^(e|err|error|_)$" },
      ],
      "no-console": "warn",
    },
  },
];
