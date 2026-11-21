// ESLint 9 flat config. `npm run lint` must exit 0 only when there are no real errors:
// undefined names, unknown JSX components and conditional hook calls are errors; style-ish rules are warnings.
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'tests/e2e/shots/**', '**/scratchpad/**', 'build-*/**'] },
  js.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: ['**/*.{js,jsx,mjs}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off', // new JSX runtime: React needn't be in scope
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off', // text extraction / file parsing legitimately matches control characters
      'no-cond-assign': ['warn', 'except-parens'],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-prototype-builtins': 'warn',
      'no-misleading-character-class': 'warn',
      'no-fallthrough': 'warn',
      'no-case-declarations': 'warn',
      'no-async-promise-executor': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },
  {
    // Config files, scripts and tests run in Node.
    files: ['*.config.js', 'tests/**/*.{js,jsx,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
