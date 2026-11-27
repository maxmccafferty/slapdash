// One ESLint config for the whole monorepo (`pnpm lint`). Type correctness is
// tsc's job (`pnpm typecheck`), so this uses the fast, non-type-aware presets.
// Architecture rules (no DOM in core, no server imports in web) live in tests.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      'evals/results/**',
      '.data/**',
      '**/.vercel/**',
      '.sully/**',
      'supabase/.temp/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Matches `verbatimModuleSyntax` in tsconfig.base.json.
      // `typeof import('…')` stays allowed for lazily loaded modules.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
