// ESLint 10 flat config (replaces .eslintrc.js, code_quality Q17). The same rule set as before:
// eslint:recommended + typescript-eslint's recommended + curly; formatting belongs to Prettier.
// npm run lint:ratchet compares the problem count with tools/eslintBaseline.json.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['js/**', 'lib/**', 'raw/**', 'node_modules/**'] },
    {
        files: ['src/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        rules: {
            curly: 'error',
        },
    },
)
