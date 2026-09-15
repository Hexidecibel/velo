// Minimal flat config. There was no house eslint config to copy from the other
// repos (they all declare `"lint": "eslint ."` with no config file, which fails),
// so this is deliberately small: type-unaware recommended rules only, no
// stylistic opinions, no per-app overrides. Enough that `pnpm lint` is honest.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/.expo/**', '**/node_modules/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Unused args prefixed with _ are intentional (Fastify handlers, catch blocks).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
