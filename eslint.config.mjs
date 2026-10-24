import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/next-env.d.ts", "**/playwright-report/**", "**/test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", Buffer: "readonly", window: "readonly", document: "readonly", fetch: "readonly", AbortController: "readonly", localStorage: "readonly", navigator: "readonly", EventSource: "readonly", Response: "readonly", Request: "readonly", Headers: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", crypto: "readonly", FormData: "readonly", File: "readonly", Blob: "readonly", XMLHttpRequest: "readonly", HTMLInputElement: "readonly", HTMLElement: "readonly", KeyboardEvent: "readonly", MutationObserver: "readonly", matchMedia: "readonly", queueMicrotask: "readonly", structuredClone: "readonly" } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
      // Sanitizers intentionally match control characters.
      "no-control-regex": "off",
    },
  },
);
