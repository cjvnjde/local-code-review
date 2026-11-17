import js from "@eslint/js";
import { builtinModules } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "node_modules/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    ".review/**",
  ]),
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, Bun: "readonly" },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "no-constant-binary-expression": "error",
      // Control-byte regexes deliberately sanitize paths, headers and labels.
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: {
      // Keep existing adapters and test doubles in scope without requiring
      // a broad type migration just to adopt linting.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["src/web/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["src/web/client/**/*.{ts,tsx}", "src/shared/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                ...builtinModules.filter((name) => !name.startsWith("bun")),
                "node:*",
                "bun",
                "bun:*",
                "**/server/**",
                "**/review/**",
                "**/git/**",
                "**/cli/**",
                "**/agent/**",
                "**/browser/**",
                "**/web-review/controller*",
              ],
              message:
                "Browser and shared modules must use browser-safe contracts in src/shared.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-this-alias": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name='only'][object.name=/^(test|it|describe)$/]",
          message:
            "Focused tests must not be committed; use a test-name filter instead.",
        },
      ],
    },
  },
  prettier,
]);
