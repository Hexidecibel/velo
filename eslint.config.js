// Copied VERBATIM from ~/local/src/views — it is the only working flat config
// in this tree, and the other repos' `"lint": "eslint ."` with no config file
// simply fails. The one addition is the final block, which gives the plain-node
// scripts under bin/ their globals; the copied blocks above it are untouched.
//
// --- begin views/eslint.config.js ---
// Minimal flat config. There was no house eslint config to copy from the other
// repos (they all declare `"lint": "eslint ."` with no config file, which fails),
// so this is deliberately small: type-unaware recommended rules only, no
// stylistic opinions, no per-app overrides. Enough that `pnpm lint` is honest.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // `release/` is the published build — a copy of dist/ that bin/deploy makes
    // and the service actually serves. It holds the same minified bundle, so
    // linting it reports hundreds of errors about somebody else's output.
    ignores: [
      '**/dist/**', '**/release/**', '**/release.new/**', '**/release.old/**',
      '**/build/**', '**/.expo/**', '**/node_modules/**', '**/*.d.ts',
    ],
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
  // --- end views/eslint.config.js ---
  //
  // Addition for this repo: bin/*.mjs are plain Node scripts, not browser or TS
  // source, and the copied config only attaches globals to **/*.{ts,tsx}.
  {
    files: ['bin/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
)
