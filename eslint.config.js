import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      semi: 'off',
      '@typescript-eslint/semi': 'off',
    },
  },
  { ignores: ['dist/', 'pkg_out/'] },
);
