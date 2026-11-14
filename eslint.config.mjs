import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['node_modules/**', '.pnpm-store/**', '.cache/**', 'dist/**', 'test-output/**'] },
  {
    files: ['src/**/*.ts', 'vite.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  {
    files: [
      'src/domain/**/*.ts',
      'src/application/**/*.ts',
      'src/modules/*/domain/**/*.ts',
      'src/modules/*/application/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          globals: [
            'window',
            'document',
            'localStorage',
            'sessionStorage',
            'indexedDB',
            'navigator',
            'fetch',
            'WebSocket',
            'Worker',
            'crypto',
            'Blob',
            'File',
            'FileReader',
            'HTMLElement',
            'console',
            'process',
            'Buffer',
          ],
          checkGlobalObject: true,
          globalObjects: ['global'],
        },
      ],
    },
  },
  {
    files: ['test/**/*.mjs', 'eslint.config.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
