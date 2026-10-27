module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    rules: {
        curly: 'error',
        // formatting belongs to Prettier (npm run format): its leading `;` before a line that starts
        // with ( [ or ` (semi: false) is not an extra semicolon
        'no-extra-semi': 'off',
        '@typescript-eslint/no-extra-semi': 'off',
    },
}
