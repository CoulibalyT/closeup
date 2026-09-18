import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/generated/**',
      'apps/web/dev-dist/**',
      'docs/prototype/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['apps/api/**', 'packages/**', '*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Nuxt auto-imports (ref, useI18n, ...) are invisible to `no-undef`; vue-tsc covers that.
    files: ['apps/web/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-undef': 'off', 'vue/multi-word-component-names': 'off' },
  },
  prettier,
);
