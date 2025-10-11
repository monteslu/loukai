import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'src/renderer/build/**',
      'src/renderer/dist/**',
      'src/web/build/**',
      'src/web/dist/**',
      '**/*.min.js',
      'src/renderer/lib/butterchurn.min.js',
      'src/renderer/lib/butterchurnPresets.min.js',
      'src/renderer/lib/cdgraphics.js',
      'static/**',
    ],
  },

  // Base JavaScript rules
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
    },
    rules: {
      // ESLint recommended
      ...js.configs.recommended.rules,

      // React rules
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/no-deprecated': 'warn',
      'react/no-direct-mutation-state': 'error',
      'react/no-is-mounted': 'error',
      'react/no-string-refs': 'error',
      'react/require-render-return': 'error',
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/self-closing-comp': 'warn',

      // React Hooks rules (strict)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Import rules
      'import/no-unresolved': 'off', // Vite handles this
      'import/named': 'error',
      'import/default': 'error',
      'import/no-duplicates': 'warn',

      // General JavaScript quality rules
      'no-console': 'off', // We use console.log for debugging
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
      curly: ['warn', 'all'],
      'no-throw-literal': 'error',
      'no-implicit-coercion': 'warn',

      // Async/Promise rules
      'require-await': 'warn',
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'warn',

      // Prevent common bugs
      'no-inner-declarations': 'off', // Modern JS allows this
      'no-case-declarations': 'error',
      'no-fallthrough': 'error',
      'no-prototype-builtins': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },

  // Main process specific rules (Node.js environment)
  {
    files: ['src/main/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off', // Console is fine in main process
    },
  },

  // Renderer process specific rules (Browser + Electron)
  {
    files: ['src/renderer/**/*.js', 'src/renderer/**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        electron: 'readonly',
        kaiAPI: 'readonly',
      },
    },
  },

  // Shared components (Browser)
  {
    files: ['src/shared/**/*.js', 'src/shared/**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Web components (Browser)
  {
    files: ['src/web/**/*.js', 'src/web/**/*.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Prettier must be last to override formatting rules
  prettierConfig,
];
