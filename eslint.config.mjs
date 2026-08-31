// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.config.{js,mjs,cjs,ts}',
      '**/next-env.d.ts',
      'packages/db/drizzle/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Fastify 处理器允许 async（onClose 钩子等期望 void 返回）。
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    // Next.js 应用使用独立的 JSX/模块解析设置，这里关闭类型感知规则，
    // 只保留基础语法与最佳实践检查。
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
