import js from "@eslint/js";

export default [
  {
    ignores: [
      "**/.next/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "node_modules/**",
      "**/*.tsbuildinfo",
      "playwright-report/**",
      "test-results/**",
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
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        self: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        IntersectionObserver: "readonly",
        ResizeObserver: "readonly",
        matchMedia: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "warn",
      "prefer-const": "warn",
    },
  },
];
