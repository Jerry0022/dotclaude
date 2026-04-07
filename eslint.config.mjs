import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "**/node_modules/**", "**/*.test.js"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["plugins/devops/hooks/**/*.js"],
    ignores: ["plugins/devops/hooks/session-start/ss.mcp.deps.js"],
    languageOptions: { sourceType: "commonjs" },
  },
  {
    files: ["plugins/devops/mcp-server/**/*.js"],
    languageOptions: { sourceType: "module" },
  },
];
