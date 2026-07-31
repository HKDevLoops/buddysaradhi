import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/", "dist/", "*.d.ts"],
  },
  {
    rules: {
      "no-unused-vars": "warn",
      "no-console": "warn",
    },
  },
];
