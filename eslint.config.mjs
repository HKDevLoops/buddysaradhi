import js from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules/",
      ".next/",
      "out/",
      "dist/",
      "build/",
      ".turbo/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "*.db",
      "*.db-journal",
      "*.db-wal",
      "*.db-shm",
      "**/*.d.ts",
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
      },
    },
    rules: {
      "no-unused-vars": "error",
      "no-console": "warn",
    },
  },
];
