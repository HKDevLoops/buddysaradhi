import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: ["dist/", "src-tauri/", "node_modules/"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        NodeJS: "readonly",
        React: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(4F46E5|4338CA|3730A3|312E81|1E1B4B)/]",
          message:
            "Indigo accents are forbidden (Rule 5). Use --accent-emerald, --accent-cyan, --accent-flare, --accent-amber, or --accent-violet.",
        },
        {
          selector: "Literal[value=/blue-(50|100|200|300|400|500|600|700|800|900)/]",
          message:
            "Tailwind blue-* accents are forbidden (Rule 5). Use emerald/cyan/flare/amber/violet.",
        },
      ],
    },
  },
];
