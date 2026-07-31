import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/", "dist/", "sdk/", "*.d.ts"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "no-console": "warn",
    },
  },
];
