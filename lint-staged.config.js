const path = require('path')

module.exports = {
  'apps/backend/**/*.{ts,js,mjs}': (filenames) => {
    const relative = filenames.map((f) => path.relative(path.resolve(__dirname, 'apps/backend'), f).replace(/\\/g, '/'))
    return `pnpm --filter @appserver/backend exec eslint --fix --cache ${relative.join(' ')}`
  },
  'apps/frontend/**/*.{ts,js,vue}': (filenames) => {
    const relative = filenames.map((f) => path.relative(path.resolve(__dirname, 'apps/frontend'), f).replace(/\\/g, '/'))
    return `pnpm --filter @appserver/frontend exec eslint --fix --cache ${relative.join(' ')}`
  },
  'apps/static-site/**/*.{ts,js,vue}': (filenames) => {
    const relative = filenames.map((f) => path.relative(path.resolve(__dirname, 'apps/static-site'), f).replace(/\\/g, '/'))
    return `pnpm --filter @appserver/static-site exec eslint --fix --cache ${relative.join(' ')}`
  },
  'apps/docs-site/**/*.{ts,js,vue}': (filenames) => {
    const relative = filenames.map((f) => path.relative(path.resolve(__dirname, 'apps/docs-site'), f).replace(/\\/g, '/'))
    return `pnpm --filter @appserver/docs-site exec eslint --fix --cache ${relative.join(' ')}`
  },
}
