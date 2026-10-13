import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'pacts/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Browser code: no Node globals here.
    files: ['app/public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        crypto: 'readonly',
        requestAnimationFrame: 'readonly',
        Option: 'readonly',
        globalThis: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
