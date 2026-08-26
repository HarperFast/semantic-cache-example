import js from '@eslint/js';
import globals from 'globals';

export default [
	{ ignores: ['node_modules/**', 'coverage/**'] },
	js.configs.recommended,
	{
		rules: {
			// Harper calls resource methods with a fixed signature, so leading
			// params are sometimes structurally required but unused.
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.node,
				databases: 'readonly',
				tables: 'readonly',
				Resource: 'readonly',
				server: 'readonly',
				logger: 'readonly',
			},
		},
	},
];
