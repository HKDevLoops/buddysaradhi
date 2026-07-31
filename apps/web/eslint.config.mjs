import js from "@eslint/js";

export default [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**"],
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
      "no-unused-vars": "off",
      "no-console": "off",
    },
  },
];
