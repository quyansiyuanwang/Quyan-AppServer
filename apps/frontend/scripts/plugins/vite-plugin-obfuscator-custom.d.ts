import type { Plugin } from 'vite'

type ObfuscatorPluginOptions = {
  exclude?: string[]
} & Record<string, unknown>

export default function obfuscatorPlugin(options?: ObfuscatorPluginOptions): Plugin