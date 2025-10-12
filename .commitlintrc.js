/**
 * Commitlint Configuration
 *
 * Enforces conventional commit message format:
 * <type>(<scope>): <subject>
 *
 * Example: feat(mixer): add per-stem EQ controls
 */

export default {
  extends: ['@commitlint/config-conventional'],

  rules: {
    // Type must be one of these
    'type-enum': [
      2,
      'always',
      [
        'feat',     // New feature
        'fix',      // Bug fix
        'docs',     // Documentation
        'style',    // Code style (formatting, semicolons, etc.)
        'refactor', // Code refactoring
        'perf',     // Performance improvements
        'test',     // Adding tests
        'chore',    // Build process, dependencies, tooling
        'revert',   // Revert a previous commit
        'ci',       // CI/CD changes
        'build',    // Build system changes
      ],
    ],

    // Subject must not be empty
    'subject-empty': [2, 'never'],

    // Subject must be lowercase
    'subject-case': [2, 'always', 'lower-case'],

    // Subject must not end with period
    'subject-full-stop': [2, 'never', '.'],

    // Subject max length
    'subject-max-length': [2, 'always', 100],

    // Body max line length
    'body-max-line-length': [2, 'always', 100],

    // Footer max line length
    'footer-max-line-length': [2, 'always', 100],

    // Allow certain scopes
    'scope-enum': [
      1,
      'always',
      [
        'mixer',
        'player',
        'queue',
        'library',
        'effects',
        'web',
        'renderer',
        'main',
        'ui',
        'api',
        'auth',
        'tests',
        'deps',
        'config',
        'ci',
        'docs',
      ],
    ],
  },
};
