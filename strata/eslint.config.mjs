import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'prettier'),
  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'playwright-report/**', 'coverage/**'],
  },
  {
    rules: {
      // XSS surface. Item content is user-authored and renders in the grid.
      'react/no-danger': 'error',

      'no-restricted-syntax': [
        'error',
        {
          // Every dynamic fragment of a `sql` template must be an interpolated
          // *parameter*, not a concatenated string. String concatenation inside
          // a sql tag is how a filter compiler becomes an injection vector.
          //
          // Restricted to operands that are demonstrably string-ish: `${n + 1}`
          // on a bound numeric limit is arithmetic, not SQL construction, and
          // flagging it trains people to disable the rule.
          selector:
            "TaggedTemplateExpression[tag.name='sql'] > TemplateLiteral BinaryExpression[operator='+']:matches([left.type='TemplateLiteral'], [right.type='TemplateLiteral'], [left.type='Literal'][left.raw=/^['\"]/], [right.type='Literal'][right.raw=/^['\"]/])",
          message:
            'No string concatenation inside a `sql` tagged template — interpolate a bound parameter instead (see filterCompiler.ts).',
        },
        {
          // `Array.prototype.join` splices caller data straight into SQL text.
          // drizzle's `sql.join` is the safe equivalent and is exempt, since it
          // joins already-parameterized SQL fragments.
          selector:
            "TaggedTemplateExpression[tag.name='sql'] > TemplateLiteral CallExpression[callee.property.name='join']:not([callee.object.name='sql'])",
          message:
            'No Array.join() inside a `sql` tagged template — use sql.join() over parameterized fragments instead.',
        },
        {
          // The one drizzle API that bypasses binding entirely. Allowed only in
          // the migration and seed scripts, which build DDL from hardcoded
          // table lists and never touch caller input.
          selector:
            "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
          message:
            'sql.raw() bypasses parameter binding. Use a bound `sql` template, sql.identifier(), or sql.join().',
        },
        {
          // SET LOCAL, never SET. Session-scoped GUCs survive on pooled
          // connections and hand one tenant's context to another tenant.
          //
          // The trailing assignment is required so this does not fire on
          // drizzle's `onDelete: 'set null'` / `'set default'`, which are the
          // only other places the token appears in a string literal.
          selector: "Literal[value=/^\\s*SET\\s+(?!LOCAL\\b)[A-Za-z_][\\w.]*\\s*(=|\\bTO\\b)/i]",
          message:
            'Use `SET LOCAL` (transaction-scoped), never `SET` — session state leaks across pooled connections.',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests deliberately probe raw SQL and unsafe shapes.
    files: ['tests/**'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Schema-level scripts: DDL built from hardcoded lists, never caller input.
    files: ['src/server/db/seed.ts', 'src/server/db/migrate.ts', 'src/server/db/reset.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
