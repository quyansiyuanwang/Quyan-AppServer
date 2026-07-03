import JavaScriptObfuscator from 'javascript-obfuscator'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

export default function obfuscatorPlugin(options = {}) {
  const { exclude = [], ...obfuscatorOptions } = options

  const excludePatterns = [
    'element-plus',
    'echarts',
    'zrender',
    '@vue',
    'vue-router',
    'vue-i18n',
    'axios',
    'crypto-js',
    'lodash',
    'pinia',
    'dayjs',
    '@element-plus',
    '@popperjs',
    '@intlify',
    '@ctrl',
    '@vueuse',
    'async-validator',
    'normalize-wheel',
    'service',
    'stores',
    ...exclude,
  ]

  function shouldObfuscate(filename) {
    return !excludePatterns.some((pattern) => filename.includes(pattern))
  }

  function obfuscateFile(filePath) {
    try {
      const code = readFileSync(filePath, 'utf8')
      const obfuscatedCode = JavaScriptObfuscator.obfuscate(
        code,
        obfuscatorOptions,
      ).getObfuscatedCode()
      writeFileSync(filePath, obfuscatedCode, 'utf8')
      console.log(`  ✅ Obfuscated: ${filePath}`)
    } catch (error) {
      console.error(`  ❌ Failed to obfuscate ${filePath}:`, error.message)
    }
  }

  function processDirectory(dir) {
    const files = readdirSync(dir)

    for (const file of files) {
      const filePath = join(dir, file)
      const stat = statSync(filePath)

      if (stat.isDirectory()) {
        processDirectory(filePath)
      } else if (extname(file) === '.js' && shouldObfuscate(file)) {
        obfuscateFile(filePath)
      }
    }
  }

  return {
    name: 'vite-plugin-obfuscator-custom',
    apply: 'build',

    closeBundle() {
      const distDir = './dist/assets'
      if (!existsSync(distDir)) {
        console.warn('⚠️  dist/assets not found, skipping obfuscation.')
        return
      }
      console.log('🔒 Starting code obfuscation...')
      processDirectory(distDir)
      console.log('🔒 Code obfuscation completed!')
    },
  }
}
