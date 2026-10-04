import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    // `.claude/` holds Claude Code agent worktrees (full copies of the repo).
    ignores: ['dist/', 'test-results/', 'playwright-report/', '.claude/', '.playwright-mcp/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Tests and tooling run in Node; Playwright specs also contain code evaluated in the page.
    files: ['tests/**/*.js', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
